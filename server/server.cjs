const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process"); // ONLY declare this ONCE here
const path            = require("path");
const fs              = require("fs");
const os              = require("os");

const app = express();
app.use(cors());
app.use(express.json());

// ── Configuration ──
let YTDLP_CMD = "yt-dlp";
const PORT = process.env.PORT || 8080;

// ── Helper: run function for Railway ──
function run(cmd) {
  return new Promise((resolve, reject) => {
    // Large buffer for YouTube metadata
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── Startup: Detect yt-dlp ──
exec("yt-dlp --version", (err) => {
  if (err) {
    YTDLP_CMD = "python3 -m yt_dlp";
    console.log("Railway Mode: Using python3 -m yt_dlp");
  } else {
    console.log("System Mode: Using yt-dlp");
  }
});

// ── Routes ──────────────────────────────────────
app.get("/ping", (_, res) => res.send("pong"));

app.get("/formats", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL" });
    
    // Uses the YTDLP_CMD we detected at startup
    const json = await run(`${YTDLP_CMD} -j --no-playlist "${url}"`);
    const info = JSON.parse(json);
    res.json({ formats: info.formats, title: info.title });
  } catch (err) {
    console.error("formats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/download", async (req, res) => {
  try {
    const { url, formatId } = req.query;
    const stamp = Date.now();
    const outPath = path.join(os.tmpdir(), `ststudio-${stamp}-%(title)s.%(ext)s`);

    await new Promise((resolve, reject) => {
      // Logic to merge video + audio for high quality
      const fmtArg = formatId ? `${formatId}+bestaudio/best` : "best";
      const proc = spawn(YTDLP_CMD.includes(" ") ? "python3" : YTDLP_CMD, 
        YTDLP_CMD.includes(" ") 
          ? ["-m", "yt_dlp", "-f", fmtArg, "--merge-output-format", "mp4", "-o", outPath, url]
          : ["-f", fmtArg, "--merge-output-format", "mp4", "-o", outPath, url]
      );

      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error("Download failed")));
    });

    const files = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`));
    const latest = files.sort().pop();
    const filePath = path.join(os.tmpdir(), latest);
    
    res.download(filePath, () => fs.unlinkSync(filePath));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => console.log(`Speech Studio Server -> port ${PORT}`));