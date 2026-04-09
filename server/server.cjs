const express        = require("express");
const cors           = require("cors");
const { exec, spawn }= require("child_process");
const path           = require("path");
const fs             = require("fs");
const os             = require("os");

const app = express();
app.use(cors());
app.use(express.json());

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

app.get("/ping",   (_, res) => res.json({ ok: true }));
app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/formats", async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "No URL provided" });
  try {
    const raw  = await run(`yt-dlp --dump-json --no-playlist "${url}"`);
    const info = JSON.parse(raw);
    const seen = new Set();
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
      .map(f => {
        const isAudio = f.vcodec === "none";
        const resolution = isAudio ? "audio" : (f.resolution || (f.height ? f.height + "p" : "unknown"));
        const label = isAudio
          ? `Audio - ${f.ext.toUpperCase()} ${f.abr ? f.abr + "kbps" : ""}`.trim()
          : `${resolution} - ${f.ext.toUpperCase()}${f.fps ? " " + f.fps + "fps" : ""}`.trim();
        return { id: f.format_id, label, isAudio, filesize: f.filesize || f.filesize_approx || null, res: isAudio ? 0 : (f.height || 0) };
      })
      .filter(f => { const k = f.label; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.res - a.res);
    res.json({ title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader, formats });
  } catch (err) {
    console.error("formats error:", err.message);
    res.status(500).json({ error: "Could not fetch video info. Check the URL and make sure yt-dlp is installed." });
  }
});

app.get("/info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL" });
  try {
    const raw  = await run(`yt-dlp --dump-json --no-playlist "${url}"`);
    const info = JSON.parse(raw);
    const seen = new Set();
    const formats = (info.formats || [])
      .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
      .map(f => ({
        formatId: f.format_id,
        label: f.format_note || f.resolution || f.ext,
        ext: f.ext,
        resolution: f.resolution || "audio only",
        fps: f.fps || null,
        filesize: f.filesize || f.filesize_approx || null,
        hasVideo: f.vcodec !== "none",
        hasAudio: f.acodec !== "none",
      }))
      .filter(f => { const k = f.resolution + f.ext; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0));
    res.json({ title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader, formats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      const args = ["-f", fmtArg, "--merge-output-format", "mp4", "--no-playlist", "-o", outPath, url];
      const proc = spawn("yt-dlp", args);
      proc.stderr.on("data", d => process.stderr.write(d));
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
    });
    const files  = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`) && f.endsWith(".mp4"));
    const latest = files.sort().pop();
    if (!latest) throw new Error("Output file not found");
    const filePath = path.join(os.tmpdir(), latest);
    const stat     = fs.statSync(filePath);
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Accept-Ranges", "bytes");
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });
  } catch (err) {
    console.error("download error:", err.message);
    if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log("\n Speech Studio Server  ->  http://localhost:" + PORT);
  console.log("   Endpoints: /ping  /formats  /info  /download\n");
});
