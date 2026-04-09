const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");

const app = express();
app.use(cors());
app.use(express.json());

// ── detect yt-dlp command on startup ──
let YTDLP_CMD = "yt-dlp";
exec("which yt-dlp", (err) => {
  if (err) {
    exec("python3 -m yt_dlp --version", (err2) => {
      if (!err2) { YTDLP_CMD = "python3 -m yt_dlp"; console.log("Using: python3 -m yt_dlp"); }
      else console.error("yt-dlp not found by any method");
    });
  } else {
    console.log("Using: yt-dlp");
  }
});

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── health ──────────────────────────────────────
app.get("/ping",   (_, res) => res.json({ ok: true }));
app.get("/health", (_, res) => res.json({ ok: true }));

// ── diagnostic ──────────────────────────────────
app.get("/check", async (req, res) => {
  const results = {};
  try { results.yt_dlp_which   = await run("which yt-dlp");          } catch(e){ results.yt_dlp_which   = e.message; }
  try { results.yt_dlp_version = await run("yt-dlp --version");      } catch(e){ results.yt_dlp_version = e.message; }
  try { results.python_yt_dlp  = await run("python3 -m yt_dlp --version"); } catch(e){ results.python_yt_dlp  = e.message; }
  try { results.ffmpeg         = await run("which ffmpeg");           } catch(e){ results.ffmpeg         = e.message; }
  results.active_cmd = YTDLP_CMD;
  res.json(results);
});

// ── /formats POST ────────────────────────────────
app.post("/formats", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "No URL provided" });
  try {
    const raw  = await run(`${YTDLP_CMD} --dump-json --no-playlist "${url}"`);
    const info = JSON.parse(raw);
    const seen = new Set();
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
      .map(f => {
        const isAudio    = f.vcodec === "none";
        const resolution = isAudio ? "audio" : (f.resolution || (f.height ? f.height+"p" : "unknown"));
        const label      = isAudio
          ? `Audio - ${f.ext.toUpperCase()}${f.abr ? " "+f.abr+"kbps" : ""}`.trim()
          : `${resolution} - ${f.ext.toUpperCase()}${f.fps ? " "+f.fps+"fps" : ""}`.trim();
        return { id: f.format_id, label, isAudio, filesize: f.filesize || f.filesize_approx || null, res: isAudio ? 0 : (f.height || 0) };
      })
      .filter(f => { if (seen.has(f.label)) return false; seen.add(f.label); return true; })
      .sort((a, b) => b.res - a.res);
    res.json({ title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader, formats });
  } catch (err) {
    console.error("formats error:", err.message);
    res.status(500).json({ error: "Could not fetch video info. " + err.message });
  }
});

// ── /info GET ────────────────────────────────────
app.get("/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL" });
  try {
    const raw  = await run(`${YTDLP_CMD} --dump-json --no-playlist "${url}"`);
    const info = JSON.parse(raw);
    const seen = new Set();
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
      .map(f => ({
        formatId:   f.format_id,
        label:      f.format_note || f.resolution || f.ext,
        ext:        f.ext,
        resolution: f.resolution || "audio only",
        fps:        f.fps || null,
        filesize:   f.filesize || f.filesize_approx || null,
        hasVideo:   f.vcodec !== "none",
        hasAudio:   f.acodec !== "none",
      }))
      .filter(f => { const k = f.resolution+f.ext; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a,b) => (parseInt(b.resolution)||0) - (parseInt(a.resolution)||0));
    res.json({ title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader, formats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /download GET ────────────────────────────────
app.get("/download", async (req, res) => {
  const { url, formatId, title } = req.query;
  if (!url || !formatId) return res.status(400).send("Missing url or formatId");
  const safeTitle = (title || "download").replace(/[^\w\s-]/g,"").trim() || "download";
  const stamp     = Date.now();
  const outPath   = path.join(os.tmpdir(), `ststudio-${stamp}.%(ext)s`);
  try {
    await new Promise((resolve, reject) => {
      const fmtArg   = formatId === "bestaudio" ? "bestaudio/best" : `${formatId}+bestaudio/best[ext=mp4]/best`;
      let prog, args;
      if (YTDLP_CMD === "python3 -m yt_dlp") {
        prog = "python3";
        args = ["-m", "yt_dlp", "-f", fmtArg, "--merge-output-format", "mp4", "--no-playlist", "-o", outPath, url];
      } else {
        prog = "yt-dlp";
        args = ["-f", fmtArg, "--merge-output-format", "mp4", "--no-playlist", "-o", outPath, url];
      }
      const proc = spawn(prog, args);
      proc.stderr.on("data", d => process.stderr.write(d));
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`Process exited ${code}`)));
    });
    const files  = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`) && f.endsWith(".mp4"));
    const latest = files.sort().pop();
    if (!latest) throw new Error("Output file not found after download");
    const filePath = path.join(os.tmpdir(), latest);
    const stat     = fs.statSync(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader("Content-Type",        "video/mp4");
    res.setHeader("Content-Length",      stat.size);
    res.setHeader("Accept-Ranges",       "bytes");
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });
  } catch (err) {
    console.error("download error:", err.message);
    if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n Speech Studio Server  ->  port ${PORT}`);
  console.log(`   Active yt-dlp: ${YTDLP_CMD}\n`);
});