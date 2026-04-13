const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");
const https           = require("https");

const app  = express();
const PORT = process.env.PORT || 8080;

// ── CORS — allow all origins (Vercel frontend + local dev) ────
app.use(cors({
  origin: "*",
  exposedHeaders: ["Content-Disposition"],
}));
app.use(express.json());

// ── paths ─────────────────────────────────────────────────────
const YTDLP_PATH    = "/tmp/yt-dlp";
const FFMPEG_PATH   = "/tmp/ffmpeg";
const COOKIES_PATH  = "/tmp/yt-cookies.txt";
const BGUTIL_DIR    = "/tmp/bgutil-server";          // bgutil server clone
const PLUGIN_DIR    = "/tmp/yt-dlp-plugins";         // yt-dlp plugin folder
const PLUGIN_ZIP    = "/tmp/bgutil-plugin.zip";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Readiness flag — set to true only after boot completes
let serverReady = false;

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

// ── generic binary downloader (follows redirects) ─────────────
function downloadBinary(url, destPath, label) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      console.log(`✓ ${label} already at ${destPath}`);
      resolve(); return;
    }
    console.log(`↓ Downloading ${label}...`);
    const file = fs.createWriteStream(destPath);
    function fetch(u, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = u.startsWith("https") ? https : require("http");
      mod.get(u, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location, hops+1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${label}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          fs.chmodSync(destPath, "755");
          console.log(`✓ ${label} ready`);
          resolve();
        });
      }).on("error", (e) => { fs.unlink(destPath, ()=>{}); reject(e); });
    }
    fetch(url);
  });
}

// ── ffmpeg static binary ──────────────────────────────────────
function downloadFfmpeg() {
  if (fs.existsSync(FFMPEG_PATH)) {
    console.log("✓ ffmpeg already at", FFMPEG_PATH);
    return Promise.resolve();
  }
  console.log("↓ Downloading ffmpeg static binary (~70MB)...");
  return new Promise((resolve, reject) => {
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const cmd = `curl -sL "${tarUrl}" | tar -xJ --wildcards --no-anchored "*/ffmpeg" -O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
    exec(cmd, { timeout: 300000, maxBuffer: 200*1024*1024 }, (err) => {
      if (err) {
        // curl pipe failed — try Node stream fallback
        console.log("curl pipe failed, trying Node stream...");
        downloadFfmpegNode().then(resolve).catch(reject);
      } else {
        console.log("✓ ffmpeg ready");
        resolve();
      }
    });
  });
}

function downloadFfmpegNode() {
  return new Promise((resolve, reject) => {
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const tmpTar = "/tmp/ffmpeg.tar.xz";
    const file   = fs.createWriteStream(tmpTar);
    function fetch(u, hops=0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = u.startsWith("https") ? https : require("http");
      mod.get(u, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location, hops+1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          exec(
            `tar -xJf "${tmpTar}" --wildcards --no-anchored "*/ffmpeg" -O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`,
            { timeout: 180000 },
            (err) => {
              try { fs.unlinkSync(tmpTar); } catch {}
              if (err) { reject(err); } else { console.log("✓ ffmpeg ready"); resolve(); }
            }
          );
        });
      }).on("error", reject);
    }
    fetch(tarUrl);
  });
}

// ── bgutil POT provider (script mode — no Docker needed) ──────
// Uses option (b): generation script invoked per yt-dlp call.
// Downloads the plugin zip + the server JS at boot.
async function setupBgutil() {
  // 1. Install the yt-dlp plugin zip
  try {
    if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true });

    if (!fs.existsSync(PLUGIN_ZIP)) {
      console.log("↓ Downloading bgutil yt-dlp plugin zip...");
      await downloadBinary(
        "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip",
        PLUGIN_ZIP,
        "bgutil plugin zip"
      );
    }

    // Unzip into plugin dir
    await run(`unzip -o "${PLUGIN_ZIP}" -d "${PLUGIN_DIR}"`);
    console.log("✓ bgutil plugin installed at", PLUGIN_DIR);
  } catch (e) {
    console.error("bgutil plugin install failed:", e.message);
  }

  // 2. Clone/set up the bgutil server (script mode)
  try {
    if (!fs.existsSync(BGUTIL_DIR)) {
      console.log("↓ Cloning bgutil server (script mode)...");
      await run(
        `git clone --depth 1 --single-branch --branch 1.3.1 ` +
        `https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "${BGUTIL_DIR}"`,
        { timeout: 120000 }
      );
    }

    // Install npm deps + compile TypeScript
    const serverDir = path.join(BGUTIL_DIR, "server");
    if (!fs.existsSync(path.join(serverDir, "node_modules"))) {
      console.log("↓ Installing bgutil npm deps...");
      await run("npm ci", { cwd: serverDir, timeout: 120000 });
      await run("npx tsc", { cwd: serverDir, timeout: 60000 });
      console.log("✓ bgutil server compiled");
    } else {
      console.log("✓ bgutil server deps already installed");
    }
  } catch (e) {
    console.error("bgutil server setup failed:", e.message);
  }
}

// ── cookies from env ──────────────────────────────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("✓ YouTube cookies written");
  } else {
    console.warn("⚠ YOUTUBE_COOKIES env not set");
  }
}

// ── arg builders ──────────────────────────────────────────────
function getCookieArgs() {
  return fs.existsSync(COOKIES_PATH) ? ["--cookies", COOKIES_PATH] : [];
}
function getCookieFlag() {
  return fs.existsSync(COOKIES_PATH) ? `--cookies "${COOKIES_PATH}"` : "";
}
function getFfmpegArgs() {
  return fs.existsSync(FFMPEG_PATH) ? ["--ffmpeg-location", FFMPEG_PATH] : [];
}
function getFfmpegFlag() {
  return fs.existsSync(FFMPEG_PATH) ? `--ffmpeg-location "${FFMPEG_PATH}"` : "";
}

// bgutil plugin dir arg — tells yt-dlp where to find the plugin
function getPluginArgs() {
  const pluginPath = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider");
  if (fs.existsSync(pluginPath)) {
    return ["--plugin-dirs", PLUGIN_DIR];
  }
  return [];
}
function getPluginFlag() {
  const pluginPath = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider");
  if (fs.existsSync(pluginPath)) {
    return `--plugin-dirs "${PLUGIN_DIR}"`;
  }
  return "";
}

// bgutil script-mode extractor arg — tells the plugin where the server script lives
function getBgutilArgs() {
  const serverDir = path.join(BGUTIL_DIR, "server");
  if (fs.existsSync(path.join(serverDir, "build", "main.js"))) {
    return ["--extractor-args", `youtubepot-bgutilscript:server_home=${serverDir}`];
  }
  return [];
}
function getBgutilFlag() {
  const serverDir = path.join(BGUTIL_DIR, "server");
  if (fs.existsSync(path.join(serverDir, "build", "main.js"))) {
    return `--extractor-args "youtubepot-bgutilscript:server_home=${serverDir}"`;
  }
  return "";
}

// ── boot ──────────────────────────────────────────────────────
async function boot() {
  console.log("\n=== Speech Studio Boot Sequence ===");

  setupCookies();

  // yt-dlp
  try {
    await downloadBinary(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      YTDLP_PATH, "yt-dlp"
    );
    const v = await run(`"${YTDLP_PATH}" --version`);
    console.log(`✓ yt-dlp ${v}`);
  } catch (e) { console.error("✗ yt-dlp:", e.message); }

  // ffmpeg
  try {
    await downloadFfmpeg();
    const fv = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`);
    console.log(`✓ ${fv}`);
  } catch (e) {
    console.error("✗ ffmpeg:", e.message);
    console.warn("  Downloads will work without audio merging.");
  }

  // bgutil POT provider
  try {
    await setupBgutil();
  } catch (e) { console.error("✗ bgutil:", e.message); }

  console.log("=== Boot complete — server starting ===\n");
  serverReady = true;
  startServer();
}

// ── server ────────────────────────────────────────────────────
function startServer() {

  // Health — always responds even if still booting
  app.get("/ping",   (_, res) => res.json({ ok: true, ready: serverReady }));
  app.get("/health", (_, res) => res.json({ ok: true, ready: serverReady }));

  // Diagnostic
  app.get("/check", async (req, res) => {
    const bgutilScript = path.join(BGUTIL_DIR, "server", "build", "main.js");
    const pluginPath   = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider");
    const r = {
      ready:   serverReady,
      ytdlp:   { exists: fs.existsSync(YTDLP_PATH)  },
      ffmpeg:  { exists: fs.existsSync(FFMPEG_PATH)  },
      cookies: fs.existsSync(COOKIES_PATH),
      bgutil:  {
        script: fs.existsSync(bgutilScript),
        plugin: fs.existsSync(pluginPath),
      },
    };
    try { r.ytdlp.version  = await run(`"${YTDLP_PATH}" --version`); }              catch (e) { r.ytdlp.error  = e.message; }
    try { r.ffmpeg.version = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`); } catch (e) { r.ffmpeg.error = e.message; }
    res.json(r);
  });

  // ── GET /formats?url= ─────────────────────────────────────
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    if (!fs.existsSync(YTDLP_PATH))
      return res.status(503).json({ error: "yt-dlp not ready yet. Wait 30s and retry." });

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${getCookieFlag()} ` +
        `${getFfmpegFlag()} ` +
        `${getPluginFlag()} ` +
        `${getBgutilFlag()} ` +
        `"${url}"`
      );

      const info = JSON.parse(raw);
      const ffmpegAvailable = fs.existsSync(FFMPEG_PATH);
      const seen = new Set();

      const formats = (info.formats || [])
        .filter(f => {
          if (!f.ext) return false;
          if (!ffmpegAvailable && f.vcodec !== "none" && f.acodec === "none") return false;
          return f.vcodec !== "none" || f.acodec !== "none";
        })
        .map(f => {
          const isAudio    = f.vcodec === "none";
          const resolution = isAudio ? "audio" : (f.resolution || (f.height ? f.height + "p" : "unknown"));
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
        ffmpegAvailable, formats,
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
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).send("yt-dlp not ready.");

    const safeTitle = (title || "download").replace(/[^\w\s-]/g, "").trim() || "download";
    const stamp     = Date.now();
    const outPath   = path.join(os.tmpdir(), `ststudio-${stamp}.%(ext)s`);
    const ffmpeg    = fs.existsSync(FFMPEG_PATH);

    try {
      await new Promise((resolve, reject) => {
        const fmtArg = ffmpeg
          ? (formatId === "bestaudio" ? "bestaudio/best" : `${formatId}+bestaudio/best[ext=mp4]/best`)
          : formatId;

        const args = [
          "-f", fmtArg,
          "--no-playlist",
          "--no-check-certificates",
          "--extractor-retries", "3",
          "--user-agent", USER_AGENT,
          "--add-header", "Accept-Language:en-US,en;q=0.9",
          ...getCookieArgs(),
          ...getFfmpegArgs(),
          ...getPluginArgs(),
          ...getBgutilArgs(),
        ];

        if (ffmpeg) args.push("--merge-output-format", "mp4");
        args.push("-o", outPath, url);

        console.log("↓ Downloading:", url, "| fmt:", formatId, "| ffmpeg:", ffmpeg);
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

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
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
    console.log(`\n🎙  Speech Studio Server on port ${PORT}\n`);
  });
}

boot();
