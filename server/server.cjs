const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");
const https           = require("https");

const app  = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

// ── yt-dlp binary path ────────────────────────────
// We download it to /tmp so we always have write permission on Railway
const YTDLP_PATH = "/tmp/yt-dlp";

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── download yt-dlp binary from GitHub releases ───
function downloadYtDlp() {
  return new Promise((resolve, reject) => {
    // Check if already downloaded in this container session
    if (fs.existsSync(YTDLP_PATH)) {
      console.log("yt-dlp already exists at", YTDLP_PATH);
      resolve();
      return;
    }

    const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
    console.log("Downloading yt-dlp binary from GitHub...");

    const file = fs.createWriteStream(YTDLP_PATH);

    function download(downloadUrl, redirectCount = 0) {
      if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }

      const mod = downloadUrl.startsWith("https") ? https : require("http");
      mod.get(downloadUrl, (res) => {
        // follow redirects (GitHub uses them)
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          download(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          // make executable
          fs.chmodSync(YTDLP_PATH, "755");
          console.log("yt-dlp downloaded and made executable");
          resolve();
        });
      }).on("error", (err) => {
        fs.unlink(YTDLP_PATH, () => {});
        reject(err);
      });
    }

    download(url);
  });
}

// ── boot sequence ─────────────────────────────────
async function boot() {
  try {
    await downloadYtDlp();

    // verify it works
    const version = await run(`${YTDLP_PATH} --version`);
    console.log(`yt-dlp version: ${version}`);
  } catch (err) {
    console.error("Failed to set up yt-dlp:", err.message);
    // don't crash — let server start, routes will return clear errors
  }

  startServer();
}

async function boot() {
  try {
    await downloadYtDlp();
    const version = await run(`${YTDLP_PATH} --version`);
    console.log(`yt-dlp version: ${version}`);
  } catch (err) {
    console.error("Failed to set up yt-dlp:", err.message);
  }

  // install ffmpeg via apt (Railway's container has apt)
  try {
    await run("ffmpeg -version");
    console.log("ffmpeg already available");
  } catch (_) {
    console.log("Installing ffmpeg...");
    try {
      await run("apt-get install -y ffmpeg 2>&1");
      console.log("ffmpeg installed");
    } catch (e) {
      console.error("ffmpeg install failed:", e.message);
    }
  }

  startServer();
}

function startServer() {

  // ── health ────────────────────────────────────────
  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  // ── diagnostic ────────────────────────────────────
  app.get("/check", async (req, res) => {
    const results = { ytdlp_path: YTDLP_PATH, exists: fs.existsSync(YTDLP_PATH) };
    try { results.version = await run(`${YTDLP_PATH} --version`); } catch(e) { results.version = e.message; }
    try { results.ffmpeg  = await run("ffmpeg -version 2>&1 | head -1"); } catch(e) { results.ffmpeg = "not found"; }
    res.json(results);
  });

  // ── GET /formats?url= ─────────────────────────────
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    if (!fs.existsSync(YTDLP_PATH)) {
      return res.status(503).json({ error: "yt-dlp not ready yet. Try again in a moment." });
    }

    try {
      const raw  = await run(`"${YTDLP_PATH}" --dump-json --no-playlist "${url}"`);
      const info = JSON.parse(raw);

      const seen    = new Set();
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
        .filter(f => { if (seen.has(f.label)) return false; seen.add(f.label); return true; })
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
  
  
    const raw = await run(
  `"${YTDLP_PATH}" --dump-json --no-playlist ` +
  `--no-check-certificates --extractor-retries 3 ` +
  `--user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
  `"${url}"`
);

  });









  // ── GET /download?url=&formatId=&title= ───────────
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");

    if (!fs.existsSync(YTDLP_PATH)) {
      return res.status(503).send("yt-dlp not ready yet.");
    }

    const safeTitle = (title || "download").replace(/[^\w\s-]/g, "").trim() || "download";
    const stamp     = Date.now();
    const outPath   = path.join(os.tmpdir(), `ststudio-${stamp}.%(ext)s`);

    try {
      await new Promise((resolve, reject) => {
        const fmtArg = formatId === "bestaudio"
          ? "bestaudio/best"
          : `${formatId}+bestaudio/best[ext=mp4]/best`;

        const args = [
          "-f", fmtArg,
          "--merge-output-format", "mp4",
          "--no-playlist",
          "-o", outPath,
          url,
        ];

        console.log("Downloading:", url, "format:", formatId);
        const proc = spawn(YTDLP_PATH, args);
        proc.stderr.on("data", d => process.stderr.write(d));
        proc.on("close", code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
      });

      const files  = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`) && f.endsWith(".mp4"));
      const latest = files.sort().pop();
      if (!latest) throw new Error("Output file not found after download");

      const filePath = path.join(os.tmpdir(), latest);
      const stat     = fs.statSync(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
      res.setHeader("Content-Type",        "video/mp4");
      res.setHeader("Content-Length",      stat.size);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });

    } catch (err) {
      console.error("download error:", err.message);
      if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
    }
  



    const args = [
  "-f", fmtArg,
  "--merge-output-format", "mp4",
  "--no-playlist",
  "--no-check-certificates",
  "--extractor-retries", "3",
  "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "-o", outPath,
  url,
];


  });

  app.listen(PORT, () => {
    console.log(`\n Speech Studio Server running on port ${PORT}\n`);
  });
}

// start
boot();