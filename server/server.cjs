/**
 * server.cjs  —  Speech Studio Media Backend
 * ─────────────────────────────────────────────────────────────────
 * Railway env variables to set:
 *
 *   PORT             → auto-set by Railway
 *   YOUTUBE_COOKIES  → your Netscape cookie file content (from browser)
 *   BGUTIL_URL       → internal URL of bgutil service, e.g:
 *                      http://bgutil-provider.railway.internal:4416
 *                      (leave blank to skip PO token — works without it)
 * ─────────────────────────────────────────────────────────────────
 */

const express         = require("express");
const cors            = require("cors");
const { exec, spawn } = require("child_process");
const path            = require("path");
const fs              = require("fs");
const os              = require("os");
const https           = require("https");
const http            = require("http");

const app  = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json());

// ── paths ─────────────────────────────────────────────────────
const YTDLP_PATH    = "/tmp/yt-dlp";
const FFMPEG_PATH   = "/tmp/ffmpeg";
const COOKIES_PATH  = "/tmp/yt-cookies.txt";
const PLUGIN_DIR    = "/tmp/yt-dlp-plugins";

// bgutil PO token provider service URL
// Set BGUTIL_URL in Railway to your bgutil service internal URL
const BGUTIL_URL = process.env.BGUTIL_URL || "";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── exec helper ───────────────────────────────────────────────
function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024, timeout: 120000, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

// ── binary downloader (follows redirects) ─────────────────────
function downloadBinary(url, destPath, label) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) { console.log(`${label} already cached`); resolve(); return; }
    console.log(`Downloading ${label}…`);
    const file = fs.createWriteStream(destPath);
    function fetch(fetchUrl, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = fetchUrl.startsWith("https") ? https : http;
      mod.get(fetchUrl, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location, hops+1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${label}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          try { fs.chmodSync(destPath, "755"); } catch {}
          console.log(`${label} ready`);
          resolve();
        });
      }).on("error", (e) => { try { fs.unlinkSync(destPath); } catch {} reject(e); });
    }
    fetch(url);
  });
}

// ── setup cookies from env var ────────────────────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("YouTube cookies written");
  } else {
    console.warn("YOUTUBE_COOKIES not set — YouTube downloads may fail");
  }
}

// ── install bgutil yt-dlp plugin ──────────────────────────────
// The plugin tells yt-dlp to fetch PO tokens from our bgutil sidecar
async function installBgutilPlugin() {
  if (!BGUTIL_URL) {
    console.log("BGUTIL_URL not set — skipping PO token plugin install");
    return;
  }
  try {
    const pluginZip = "/tmp/bgutil-plugin.zip";
    const pluginDest = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider.zip");

    if (fs.existsSync(pluginDest)) {
      console.log("bgutil plugin already installed");
      return;
    }

    fs.mkdirSync(PLUGIN_DIR, { recursive: true });

    // Download the plugin zip from the latest release
    await downloadBinary(
      "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip",
      pluginZip,
      "bgutil yt-dlp plugin"
    );

    fs.copyFileSync(pluginZip, pluginDest);
    try { fs.unlinkSync(pluginZip); } catch {}
    console.log("bgutil plugin installed to", pluginDest);
  } catch (e) {
    console.warn("bgutil plugin install failed:", e.message);
    console.warn("Downloads will still work but may hit PO token 403 errors");
  }
}

// ── check if bgutil service is alive ─────────────────────────
function checkBgutil() {
  return new Promise((resolve) => {
    if (!BGUTIL_URL) { resolve(false); return; }
    try {
      const parsed = new URL(BGUTIL_URL);
      const mod    = parsed.protocol === "https:" ? https : http;
      const req    = mod.get(`${BGUTIL_URL}/`, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

// ── build yt-dlp args ─────────────────────────────────────────
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
function getPluginArgs() {
  if (!BGUTIL_URL || !fs.existsSync(PLUGIN_DIR)) return [];
  return ["--plugin-dirs", PLUGIN_DIR,
          "--extractor-args", `youtubepot-bgutilhttp:base_url=${BGUTIL_URL}`];
}
function getPluginFlag() {
  if (!BGUTIL_URL || !fs.existsSync(PLUGIN_DIR)) return "";
  return `--plugin-dirs "${PLUGIN_DIR}" --extractor-args "youtubepot-bgutilhttp:base_url=${BGUTIL_URL}"`;
}

// ── ffmpeg download ───────────────────────────────────────────
function downloadFfmpeg() {
  return new Promise((resolve, reject) => {
    const tarUrl =
      "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const cmd =
      `curl -sL "${tarUrl}" | tar -xJ --wildcards --no-anchored "*/ffmpeg" ` +
      `-O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
    exec(cmd, { timeout: 180000, maxBuffer: 100 * 1024 * 1024 }, (err) => {
      if (err) { downloadFfmpegNodeStream().then(resolve).catch(reject); return; }
      console.log("ffmpeg extracted via curl");
      resolve();
    });
  });
}

function downloadFfmpegNodeStream() {
  return new Promise((resolve, reject) => {
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const tmpTar = "/tmp/ffmpeg.tar.xz";
    const file   = fs.createWriteStream(tmpTar);
    function fetch(url, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location, hops+1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          const cmd = `tar -xJf "${tmpTar}" --wildcards --no-anchored "*/ffmpeg" -O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
          exec(cmd, { timeout: 120000 }, (err) => {
            try { fs.unlinkSync(tmpTar); } catch {}
            if (err) { reject(err); return; }
            console.log("ffmpeg extracted via Node stream");
            resolve();
          });
        });
      }).on("error", reject);
    }
    fetch(tarUrl);
  });
}

// ── boot ──────────────────────────────────────────────────────
async function boot() {
  setupCookies();

  // 1. yt-dlp
  try {
    await downloadBinary(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      YTDLP_PATH, "yt-dlp"
    );
    const v = await run(`"${YTDLP_PATH}" --version`);
    console.log(`yt-dlp ${v}`);
  } catch (e) { console.error("yt-dlp setup failed:", e.message); }

  // 2. ffmpeg
  try {
    if (!fs.existsSync(FFMPEG_PATH)) {
      console.log("Downloading ffmpeg…");
      await downloadFfmpeg();
    } else {
      try { fs.chmodSync(FFMPEG_PATH, "755"); } catch {}
      console.log("ffmpeg already cached, permissions refreshed");
    }
    const fv = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`);
    console.log(fv);
  } catch (e) {
    console.warn("ffmpeg unavailable:", e.message);
  }

  // 3. bgutil PO token plugin
  await installBgutilPlugin();

  // 4. check bgutil connectivity
  const bgutilAlive = await checkBgutil();
  if (BGUTIL_URL) {
    console.log(`bgutil service: ${bgutilAlive ? "ONLINE ✅" : "OFFLINE ⚠️ (will retry per-request)"}`);
  }

  startServer();
}

// ── server routes ─────────────────────────────────────────────
function startServer() {

  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  // /check — full status
  app.get("/check", async (_, res) => {
    const bgutilAlive = await checkBgutil();
    const r = {
      ytdlp:   { exists: fs.existsSync(YTDLP_PATH) },
      ffmpeg:  { exists: fs.existsSync(FFMPEG_PATH) },
      cookies: fs.existsSync(COOKIES_PATH),
      bgutil:  { url: BGUTIL_URL || "(not set)", online: bgutilAlive },
      plugin:  fs.existsSync(PLUGIN_DIR),
    };
    try { r.ytdlp.version  = await run(`"${YTDLP_PATH}" --version`); }          catch (e) { r.ytdlp.error  = e.message; }
    try { r.ffmpeg.version = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`); } catch (e) { r.ffmpeg.error = e.message; }
    res.json(r);
  });

  // /auth-url — cookie setup instructions
  app.get("/auth-url", (_, res) => {
    const cookieStatus = fs.existsSync(COOKIES_PATH) ? "LOADED" : "NOT SET";
    const bgutilStatus = BGUTIL_URL ? `configured (${BGUTIL_URL})` : "NOT SET";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      "=== Speech Studio Backend Status ===",
      "",
      `Cookies:       ${cookieStatus}`,
      `bgutil PO token: ${bgutilStatus}`,
      `yt-dlp:        ${fs.existsSync(YTDLP_PATH) ? "ready" : "not downloaded"}`,
      `ffmpeg:        ${fs.existsSync(FFMPEG_PATH) ? "ready" : "not downloaded"}`,
      "",
      "=== Setup Guide ===",
      "",
      "COOKIES (required for YouTube):",
      "  1. Install 'Get cookies.txt LOCALLY' Chrome extension",
      "  2. Go to youtube.com while logged in",
      "  3. Click extension → Export cookies",
      "  4. Open the .txt file, copy ALL text",
      "  5. Railway → Variables → YOUTUBE_COOKIES → paste → Save",
      "",
      "PO TOKENS (recommended, prevents 403 errors):",
      "  1. In Railway → your project → New Service → Docker Image",
      "  2. Image name: brainicism/bgutil-ytdlp-pot-provider:latest",
      "  3. Deploy it, note the internal hostname from Settings",
      "  4. Railway → your main service → Variables → add:",
      "     BGUTIL_URL = http://<internal-hostname>.railway.internal:4416",
      "  5. Redeploy your main service",
      "",
      "Visit /check to verify everything is working.",
    ].join("\n"));
  });

  // GET /formats?url=
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).json({ error: "yt-dlp not ready yet — try in 30s" });

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${getCookieFlag()} ` +
        `${getFfmpegFlag()} ` +
        `${getPluginFlag()} ` +
        `"${url}"`
      );

      const info            = JSON.parse(raw);
      const ffmpegAvailable = fs.existsSync(FFMPEG_PATH);

      const seen    = new Set();
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
            ? `Audio — ${f.ext.toUpperCase()}${f.abr ? " " + Math.round(f.abr) + "kbps" : ""}`.trim()
            : `${resolution} — ${f.ext.toUpperCase()}${f.fps ? " " + f.fps + "fps" : ""}`.trim();
          return {
            id:       f.format_id,
            label,
            isAudio,
            hasAudio: f.acodec !== "none",
            filesize: f.filesize || f.filesize_approx || null,
            res:      isAudio ? 0 : (f.height || 0),
          };
        })
        .filter(f => {
          if (seen.has(f.label)) return false;
          seen.add(f.label); return true;
        })
        .sort((a, b) => b.res - a.res);

      res.json({
        title:          info.title,
        thumbnail:      info.thumbnail,
        duration:       info.duration,
        uploader:       info.uploader,
        ffmpegAvailable,
        formats,
      });
    } catch (err) {
      console.error("formats error:", err.message);
      res.status(500).json({ error: "Could not fetch video info: " + err.message });
    }
  });

  // GET /download?url=&formatId=&title=
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).send("yt-dlp not ready");

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
        ];

        if (ffmpeg) args.push("--merge-output-format", "mp4");
        args.push("-o", outPath, url);

        console.log(`Downloading: format=${formatId} ffmpeg=${ffmpeg} bgutil=${!!BGUTIL_URL}`);
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
      const mime     = mimeMap[ext] || "application/octet-stream";
      const stat     = fs.statSync(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", stat.size);
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
    console.log(`\n  Speech Studio backend on port ${PORT}`);
    console.log(`  Cookies:  ${fs.existsSync(COOKIES_PATH) ? "loaded" : "missing"}`);
    console.log(`  bgutil:   ${BGUTIL_URL || "not configured"}`);
    console.log(`  ffmpeg:   ${fs.existsSync(FFMPEG_PATH) ? "ready" : "downloading"}\n`);
  });
}

boot();
