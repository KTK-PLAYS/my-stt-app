const express         = require("express");
const cors            = require("cors");
const { exec, execSync, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");

const app  = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

// ── install yt-dlp at runtime if missing ─────────
// Railway doesn't run nixpacks.toml reliably for binary packages
// so we install directly when the server boots
function installDeps() {
  return new Promise((resolve) => {
    console.log("Checking for yt-dlp...");

    // Try yt-dlp directly first
    exec("yt-dlp --version", (err) => {
      if (!err) {
        console.log("yt-dlp already available");
        resolve("yt-dlp");
        return;
      }

      console.log("yt-dlp not found. Installing via pip...");

      // Try pip install
      exec("pip install yt-dlp 2>&1 || pip3 install yt-dlp 2>&1", (err2, stdout2) => {
        console.log("pip output:", stdout2);

        // Check again after install
        exec("yt-dlp --version", (err3) => {
          if (!err3) {
            console.log("yt-dlp installed successfully via pip");
            resolve("yt-dlp");
            return;
          }

          // Try python -m yt_dlp as last resort
          exec("python -m yt_dlp --version 2>&1 || python3 -m yt_dlp --version 2>&1", (err4, stdout4) => {
            if (!err4 || stdout4.includes("yt-dlp")) {
              console.log("Using python -m yt_dlp");
              resolve("python -m yt_dlp");
            } else {
              // Final attempt: download yt-dlp binary directly
              console.log("Attempting direct binary download...");
              try {
                execSync("curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp");
                console.log("yt-dlp binary downloaded successfully");
                resolve("yt-dlp");
              } catch (e) {
                console.error("All installation methods failed:", e.message);
                resolve("yt-dlp"); // will fail at runtime with clear error
              }
            }
          });
        });
      });
    });
  });
}

// ── helper ────────────────────────────────────────
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── boot: install deps then start server ──────────
let YTDLP_CMD = "yt-dlp";

installDeps().then((cmd) => {
  YTDLP_CMD = cmd;
  console.log(`Active command: ${YTDLP_CMD}`);

  // ── routes ──────────────────────────────────────

  app.get("/ping",   (_, res) => res.json({ ok: true, cmd: YTDLP_CMD }));
  app.get("/health", (_, res) => res.json({ ok: true, cmd: YTDLP_CMD }));

  // diagnostic — visit this to see what's installed
  app.get("/check", async (req, res) => {
    const results = {};
    const checks = [
      ["yt_dlp_version",  "yt-dlp --version"],
      ["pip_list",        "pip show yt-dlp 2>&1 || echo 'not via pip'"],
      ["python_version",  "python --version 2>&1 || python3 --version 2>&1 || echo 'no python'"],
      ["which_ytdlp",     "which yt-dlp 2>&1 || echo 'not in PATH'"],
      ["ffmpeg",          "ffmpeg -version 2>&1 | head -1 || echo 'no ffmpeg'"],
    ];
    for (const [key, cmd] of checks) {
      try { results[key] = await run(cmd); } catch(e) { results[key] = "ERROR: " + e.message; }
    }
    results.active_cmd = YTDLP_CMD;
    res.json(results);
  });

  // GET /formats?url=...
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    try {
      const raw  = await run(`${YTDLP_CMD} --dump-json --no-playlist "${url}"`);
      const info = JSON.parse(raw);

      const seen = new Set();
      const formats = (info.formats || [])
        .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
        .map(f => {
          const isAudio    = f.vcodec === "none";
          const resolution = isAudio ? "audio" : (f.resolution || (f.height ? f.height + "p" : "unknown"));
          const label      = isAudio
            ? `Audio - ${f.ext.toUpperCase()}${f.abr ? " " + f.abr + "kbps" : ""}`.trim()
            : `${resolution} - ${f.ext.toUpperCase()}${f.fps ? " " + f.fps + "fps" : ""}`.trim();
          return {
            id:       f.format_id,
            label,
            isAudio,
            filesize: f.filesize || f.filesize_approx || null,
            res:      isAudio ? 0 : (f.height || 0),
          };
        })
        .filter(f => {
          if (seen.has(f.label)) return false;
          seen.add(f.label);
          return true;
        })
        .sort((a, b) => b.res - a.res);

      res.json({
        title:     info.title,
        thumbnail: info.thumbnail,
        duration:  info.duration,
        uploader:  info.uploader,
        formats,
      });
    } catch (err) {
      console.error("formats error:", err.message);
      res.status(500).json({ error: "Could not fetch video info: " + err.message });
    }
  });

  // GET /download?url=...&formatId=...&title=...
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");

    const safeTitle = (title || "download").replace(/[^\w\s-]/g, "").trim() || "download";
    const stamp     = Date.now();
    const outPath   = path.join(os.tmpdir(), `ststudio-${stamp}.%(ext)s`);

    try {
      await new Promise((resolve, reject) => {
        const fmtArg = formatId === "bestaudio"
          ? "bestaudio/best"
          : `${formatId}+bestaudio/best[ext=mp4]/best`;

        let prog, args;
        if (YTDLP_CMD.startsWith("python")) {
          const pyBin = YTDLP_CMD.split(" ")[0];
          prog = pyBin;
          args = ["-m", "yt_dlp", "-f", fmtArg, "--merge-output-format", "mp4", "--no-playlist", "-o", outPath, url];
        } else {
          prog = "yt-dlp";
          args = ["-f", fmtArg, "--merge-output-format", "mp4", "--no-playlist", "-o", outPath, url];
        }

        console.log("Spawning:", prog, args.join(" "));
        const proc = spawn(prog, args);
        proc.stderr.on("data", d => process.stderr.write(d));
        proc.on("close", code => code === 0 ? resolve() : reject(new Error(`Process exited ${code}`)));
      });

      const files  = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`) && f.endsWith(".mp4"));
      const latest = files.sort().pop();
      if (!latest) throw new Error("Output file not found");

      const filePath = path.join(os.tmpdir(), latest);
      const stat     = fs.statSync(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
      res.setHeader("Content-Type",        "video/mp4");
      res.setHeader("Content-Length",      stat.size);

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });

    } catch (err) {
      console.error("download error:", err.message);
      if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`\n Speech Studio Server running on port ${PORT}`);
    console.log(` Active yt-dlp: ${YTDLP_CMD}\n`);
  });
});