/**
 * server.cjs  —  Speech Studio Media Backend
 * ─────────────────────────────────────────────────────────────
 * All binaries (ffmpeg, yt-dlp, bgutil) are baked into the
 * Docker image at build time. Nothing is downloaded at runtime.
 *
 * Railway env variables required:
 *   PORT             → auto-set by Railway
 *   YOUTUBE_COOKIES  → Netscape cookie file content (from browser)
 * ─────────────────────────────────────────────────────────────
 */

const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");

const app  = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: "*", exposedHeaders: ["Content-Disposition"] }));
app.use(express.json());

// ── binary paths — all baked into image by Dockerfile ─────────
const YTDLP_PATH   = "/usr/local/bin/yt-dlp";    // installed by Dockerfile
const FFMPEG_PATH  = "ffmpeg";                    // on PATH via apt
const COOKIES_PATH = "/tmp/yt-cookies.txt";       // written from env at boot
const BGUTIL_DIR   = "/opt/bgutil-server/server"; // cloned by Dockerfile
const PLUGIN_DIR   = "/opt/yt-dlp-plugins";       // plugin zip extracted by Dockerfile

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── exec helper ───────────────────────────────────────────────
function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 180000, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

// ── cookies from env ──────────────────────────────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("✓ YouTube cookies written");
  } else {
    console.warn("⚠  YOUTUBE_COOKIES not set — YouTube may block requests");
  }
}

// ── arg builders ──────────────────────────────────────────────
function cookieArgs() {
  return fs.existsSync(COOKIES_PATH) ? ["--cookies", COOKIES_PATH] : [];
}
function cookieFlag() {
  return fs.existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : "";
}

// bgutil script mode — yt-dlp calls the script to auto-generate PO tokens
function bgutilArgs() {
  const script = path.join(BGUTIL_DIR, "build", "main.js");
  if (fs.existsSync(script)) {
    return [
      "--plugin-dirs", PLUGIN_DIR,
      "--extractor-args", `youtubepot-bgutilscript:server_home=${BGUTIL_DIR}`,
    ];
  }
  return [];
}
function bgutilFlag() {
  const script = path.join(BGUTIL_DIR, "build", "main.js");
  if (fs.existsSync(script)) {
    return `--plugin-dirs "${PLUGIN_DIR}" --extractor-args "youtubepot-bgutilscript:server_home=${BGUTIL_DIR}"`;
  }
  return "";
}

// ── boot ──────────────────────────────────────────────────────
async function boot() {
  console.log("\n=== Speech Studio Boot ===");
  setupCookies();

  // Quick sanity checks on image-baked binaries
  try {
    const v  = await run(`${YTDLP_PATH} --version`);
    console.log(`✓ yt-dlp ${v}`);
  } catch (e) { console.error("✗ yt-dlp check failed:", e.message); }

  try {
    const fv = await run(`ffmpeg -version 2>&1 | head -1`);
    console.log(`✓ ${fv}`);
  } catch (e) { console.error("✗ ffmpeg check failed:", e.message); }

  try {
    const bg = path.join(BGUTIL_DIR, "build", "main.js");
    console.log(`✓ bgutil script: ${fs.existsSync(bg) ? "ready" : "NOT FOUND"}`);
    console.log(`✓ bgutil plugin: ${fs.existsSync(path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider")) ? "ready" : "NOT FOUND"}`);
  } catch {}

  console.log("=========================\n");
  startServer();
}

// ── server ────────────────────────────────────────────────────
function startServer() {

  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  app.get("/check", async (_, res) => {
    const bgScript = path.join(BGUTIL_DIR, "build", "main.js");
    const bgPlugin = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider");
    const r = {
      ytdlp:   { path: YTDLP_PATH,  exists: fs.existsSync(YTDLP_PATH) },
      ffmpeg:  { path: "system apt", exists: true },
      cookies: fs.existsSync(COOKIES_PATH),
      bgutil:  { script: fs.existsSync(bgScript), plugin: fs.existsSync(bgPlugin) },
    };
    try { r.ytdlp.version  = await run(`${YTDLP_PATH} --version`); }       catch (e) { r.ytdlp.error  = e.message; }
    try { r.ffmpeg.version = await run(`ffmpeg -version 2>&1 | head -1`); } catch (e) { r.ffmpeg.error = e.message; }
    res.json(r);
  });

  // ── GET /formats?url= ─────────────────────────────────────
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${cookieFlag()} ` +
        `${bgutilFlag()} ` +
        `"${url}"`
      );

      const info = JSON.parse(raw);
      const seen = new Set();

      const formats = (info.formats || [])
        .filter(f => f.ext && (f.vcodec !== "none" || f.acodec !== "none"))
        .map(f => {
          const isAudio    = f.vcodec === "none";
          const resolution = isAudio ? "audio" : (f.resolution || (f.height ? `${f.height}p` : "unknown"));
          const label      = isAudio
            ? `Audio - ${f.ext.toUpperCase()}${f.abr ? " " + Math.round(f.abr) + "kbps" : ""}`.trim()
            : `${resolution} - ${f.ext.toUpperCase()}${f.fps ? " " + f.fps + "fps" : ""}`.trim();
          return {
            id:       f.format_id,
            label,
            isAudio,
            hasAudio: f.acodec !== "none",
            filesize: f.filesize || f.filesize_approx || null,
            res:      isAudio ? 0 : (f.height || 0),
          };
        })
        .filter(f => { if (seen.has(f.label)) return false; seen.add(f.label); return true; })
        .sort((a, b) => b.res - a.res);

      res.json({
        title: info.title, thumbnail: info.thumbnail,
        duration: info.duration, uploader: info.uploader,
        ffmpegAvailable: true,
        formats,
      });
    } catch (err) {
      console.error("formats error:", err.message);
      res.status(500).json({ error: "Could not fetch video info: " + err.message });
    }
  });

  // ── GET /download?url=&formatId=&title= ───────────────────
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");

    const safeTitle = (title || "download")
      .replace(/[/\\:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "download";

    const stamp   = Date.now();
    const outPath = path.join(os.tmpdir(), `ststudio-${stamp}.%(ext)s`);

    try {
      await new Promise((resolve, reject) => {
        const fmtArg = formatId === "bestaudio"
          ? "bestaudio/best"
          : `${formatId}+bestaudio/best[ext=mp4]/best`;

        const args = [
          "-f", fmtArg,
          "--merge-output-format", "mp4",
          "--no-playlist",
          "--no-check-certificates",
          "--extractor-retries", "3",
          "--user-agent", USER_AGENT,
          "--add-header", "Accept-Language:en-US,en;q=0.9",
          "--ffmpeg-location", FFMPEG_PATH,
          ...cookieArgs(),
          ...bgutilArgs(),
          "-o", outPath,
          url,
        ];

        console.log("↓ Downloading:", url, "| fmt:", formatId);
        const proc = spawn(YTDLP_PATH, args);
        proc.stderr.on("data", d => process.stderr.write(d));
        proc.on("close", code => code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
      });

      const allFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`));
      const outFile  = allFiles.sort().pop();
      if (!outFile) throw new Error("Output file not found after download");

      const filePath = path.join(os.tmpdir(), outFile);
      const ext      = path.extname(outFile).replace(".", "") || "mp4";
      const mimeMap  = { mp4:"video/mp4", webm:"video/webm", m4a:"audio/m4a", mp3:"audio/mpeg", ogg:"audio/ogg" };
      const stat     = fs.statSync(filePath);

      const encodedName = encodeURIComponent(`${safeTitle}.${ext}`);
      res.setHeader("Content-Disposition",
        `attachment; filename="${safeTitle}.${ext}"; filename*=UTF-8''${encodedName}`);
      res.setHeader("Content-Type",        mimeMap[ext] || "application/octet-stream");
      res.setHeader("Content-Length",      stat.size);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", () => { try { fs.unlinkSync(filePath); } catch {} });

    } catch (err) {
      console.error("download error:", err.message);
      if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`🎙  Speech Studio Server on port ${PORT}`);
    console.log(`   ffmpeg:  system (apt)`);
    console.log(`   yt-dlp:  ${YTDLP_PATH}`);
    console.log(`   cookies: ${fs.existsSync(COOKIES_PATH) ? "loaded" : "MISSING"}`);
    console.log(`   bgutil:  ${fs.existsSync(path.join(BGUTIL_DIR, "build", "main.js")) ? "ready" : "not found"}\n`);
  });
}

boot();
