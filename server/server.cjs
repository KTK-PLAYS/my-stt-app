const express = require("express");
const cors = require("cors");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ── Startup: Detect yt-dlp environment ──
let YTDLP_CMD = "yt-dlp";
exec("yt-dlp --version", (err) => {
  if (err) {
    YTDLP_CMD = "python3 -m yt_dlp";
    console.log("Railway Mode: Using python3 -m yt_dlp");
  } else {
    console.log("System Mode: Using yt-dlp");
  }
});

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 15 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── Routes ──
app.get("/ping", (_, res) => res.send("pong"));

app.get("/formats", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "Missing URL" });

    // Stealth command to bypass YouTube bot detection
    const cmd = `${YTDLP_CMD} --dump-json --no-playlist --no-check-certificates --extractor-retries 3 --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" --add-header "Accept-Language:en-US,en;q=0.9" "${url}"`;

    const json = await run(cmd);
    const info = JSON.parse(json);

    const formats = info.formats
      .filter(f => f.vcodec !== "none" || f.acodec !== "none")
      .map(f => ({
        id: f.format_id,
        label: `${f.resolution || f.format_note || "Audio"} (${f.ext})`,
        isAudio: f.vcodec === "none",
        filesize: f.filesize || f.filesize_approx
      }));

    res.json({ formats, title: info.title, thumbnail: info.thumbnail, duration: info.duration_string });
  } catch (err) {
    console.error("Formats Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/download", async (req, res) => {
  try {
    const { url, formatId, title } = req.query;
    if (!url) return res.status(400).send("Missing URL");

    const stamp = Date.now();
    const outPath = path.join(os.tmpdir(), `ststudio-${stamp}-%(title)s.%(ext)s`);
    const safeTitle = (title || "download").replace(/[^\w\s]/gi, "").substring(0, 50);

    await new Promise((resolve, reject) => {
      const fmtArg = formatId ? `${formatId}+bestaudio/best` : "best";
      
      // Stealth arguments for downloading
      const args = [
        "-f", fmtArg,
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--no-check-certificates",
        "--extractor-retries", "3",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
        "-o", outPath,
        url
      ];

      // Handle python3 fallback for Railway
      const isPython = YTDLP_CMD.includes("python3");
      const prog = isPython ? "python3" : YTDLP_CMD;
      const finalArgs = isPython ? ["-m", "yt_dlp", ...args] : args;

      const proc = spawn(prog, finalArgs);
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`)));
    });

    // Find the downloaded file
    const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`));
    if (!files.length) throw new Error("Download failed, file not found.");
    
    const latest = files.sort().pop();
    const filePath = path.join(os.tmpdir(), latest);
    const stat = fs.statSync(filePath);

    // Cross-origin headers to force browser "Save As" behavior
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("close", () => {
      try { fs.unlinkSync(filePath); } catch (e) { console.error("Cleanup error:", e); }
    });

  } catch (err) {
    console.error("Download Error:", err.message);
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => console.log(`Speech Studio Server -> port ${PORT}`));