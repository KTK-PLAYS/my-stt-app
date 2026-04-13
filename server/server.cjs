/**
 * server.cjs  —  Speech Studio Media Backend
 * ─────────────────────────────────────────────────────────────────
 * Railway env variables:
 *
 *   PORT             → auto-set by Railway
 *   YOUTUBE_COOKIES  → Netscape cookie file content (from browser)
 *   BGUTIL_URL       → http://bgutil-ytdlp-pot-provider.railway.internal:4416
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
const YTDLP_PATH   = "/tmp/yt-dlp";
const FFMPEG_PATH  = "/tmp/ffmpeg";
const COOKIES_PATH = "/tmp/yt-cookies.txt";
const PLUGIN_DIR   = "/tmp/yt-dlp-plugins";
const NODE_PATH    = process.execPath; // the Node.js binary running this script

// bgutil PO token provider — set BGUTIL_URL in Railway variables
const BGUTIL_URL = (process.env.BGUTIL_URL || "").trim();

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
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          fetch(res.headers.location, hops + 1); return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${label}`)); return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          try { fs.chmodSync(destPath, "755"); } catch (e) { console.warn("chmod failed:", e.message); }
          console.log(`${label} ready`);
          resolve();
        });
      }).on("error", (e) => { try { fs.unlinkSync(destPath); } catch (_) {} reject(e); });
    }
    fetch(url);
  });
}

// ── cookies setup ─────────────────────────────────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("YouTube cookies written");
  } else {
    console.warn("YOUTUBE_COOKIES not set");
  }
}

// ── install bgutil yt-dlp plugin ──────────────────────────────
async function installBgutilPlugin() {
  if (!BGUTIL_URL) {
    console.log("BGUTIL_URL not set — skipping PO token plugin");
    return;
  }
  try {
    const pluginDest = path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider.zip");
    if (fs.existsSync(pluginDest)) {
      console.log("bgutil plugin already installed");
      return;
    }
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    const tmpZip = "/tmp/bgutil-plugin.zip";
    await downloadBinary(
      "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip",
      tmpZip,
      "bgutil yt-dlp plugin"
    );
    fs.copyFileSync(tmpZip, pluginDest);
    try { fs.unlinkSync(tmpZip); } catch (_) {}
    console.log("bgutil plugin installed →", pluginDest);
  } catch (e) {
    console.warn("bgutil plugin install failed:", e.message);
  }
}

// ── check bgutil service health ───────────────────────────────
function checkBgutil() {
  return new Promise((resolve) => {
    if (!BGUTIL_URL) { resolve(false); return; }
    try {
      const parsed = new URL(BGUTIL_URL);
      const mod    = parsed.protocol === "https:" ? https : http;
      const req    = mod.get(`${BGUTIL_URL}/`, (res) => { resolve(res.statusCode < 500); });
      req.on("error", () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    } catch (_) { resolve(false); }
  });
}

// ── ffmpeg download ───────────────────────────────────────────
function downloadFfmpeg() {
  return new Promise((resolve, reject) => {
    // Use a .gz build instead of .xz — Railway containers don't have xz
    // John Van Sickle also provides a gzip version
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.gz";
    const cmd =
      `curl -sL "${tarUrl}" | tar -xz --wildcards --no-anchored "*/ffmpeg" ` +
      `-O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
    exec(cmd, { timeout: 300000, maxBuffer: 200 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.log("curl/tar failed, trying Node stream…", stderr.slice(0, 200));
        downloadFfmpegNodeStream().then(resolve).catch(reject);
        return;
      }
      console.log("ffmpeg extracted via curl+tar");
      resolve();
    });
  });
}

function downloadFfmpegNodeStream() {
  return new Promise((resolve, reject) => {
    // Fall back to the gz archive using Node https + tar gz (no xz needed)
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.gz";
    const tmpTar = "/tmp/ffmpeg.tar.gz";
    const file   = fs.createWriteStream(tmpTar);
    console.log("Streaming ffmpeg tar.gz via Node…");

    function fetch(url, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) { fetch(res.headers.location, hops + 1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          // tar gz — no xz needed
          const cmd = `tar -xzf "${tmpTar}" --wildcards --no-anchored "*/ffmpeg" -O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
          exec(cmd, { timeout: 180000 }, (err2) => {
            try { fs.unlinkSync(tmpTar); } catch (_) {}
            if (err2) { reject(err2); return; }
            console.log("ffmpeg extracted via Node stream");
            resolve();
          });
        });
      }).on("error", reject);
    }
    fetch(tarUrl);
  });
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
// Tell yt-dlp to use the Node.js binary that is running this script
// This fixes: "No supported JavaScript runtime could be found"
function getJsRuntimeArgs() {
  return ["--js-runtimes", `node:${NODE_PATH}`];
}
function getJsRuntimeFlag() {
  return `--js-runtimes "node:${NODE_PATH}"`;
}
function getPluginArgs() {
  if (!BGUTIL_URL || !fs.existsSync(PLUGIN_DIR)) return [];
  return [
    "--plugin-dirs", PLUGIN_DIR,
    "--extractor-args", `youtubepot-bgutilhttp:base_url=${BGUTIL_URL}`,
  ];
}
function getPluginFlag() {
  if (!BGUTIL_URL || !fs.existsSync(PLUGIN_DIR)) return "";
  return `--plugin-dirs "${PLUGIN_DIR}" --extractor-args "youtubepot-bgutilhttp:base_url=${BGUTIL_URL}"`;
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

  // 2. ffmpeg (using .gz — no xz dependency)
  try {
    if (!fs.existsSync(FFMPEG_PATH)) {
      await downloadFfmpeg();
    } else {
      try { fs.chmodSync(FFMPEG_PATH, "755"); } catch (_) {}
      console.log("ffmpeg already cached");
    }
    const fv = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`);
    console.log(fv);
  } catch (e) {
    console.warn("ffmpeg unavailable — merging disabled:", e.message);
  }

  // 3. bgutil plugin
  await installBgutilPlugin();

  // 4. bgutil health check
  const bgutilAlive = await checkBgutil();
  if (BGUTIL_URL) {
    console.log(`bgutil: ${bgutilAlive ? "ONLINE ✅" : "OFFLINE ⚠️"} — ${BGUTIL_URL}`);
  }

  // 5. log Node path so we can confirm JS runtime
  console.log(`Node.js runtime: ${NODE_PATH}`);

  startServer();
}

// ── routes ────────────────────────────────────────────────────
function startServer() {

  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  app.get("/check", async (_, res) => {
    const bgutilAlive = await checkBgutil();
    const r = {
      ytdlp:   { exists: fs.existsSync(YTDLP_PATH) },
      ffmpeg:  { exists: fs.existsSync(FFMPEG_PATH) },
      cookies: fs.existsSync(COOKIES_PATH),
      bgutil:  { url: BGUTIL_URL || "(not set)", online: bgutilAlive },
      plugin:  fs.existsSync(path.join(PLUGIN_DIR, "bgutil-ytdlp-pot-provider.zip")),
      nodeRuntime: NODE_PATH,
    };
    try { r.ytdlp.version  = await run(`"${YTDLP_PATH}" --version`); }               catch (e) { r.ytdlp.error  = e.message; }
    try { r.ffmpeg.version = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`); } catch (e) { r.ffmpeg.error = e.message; }
    res.json(r);
  });

  app.get("/auth-url", (_, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      "=== Speech Studio Backend Status ===",
      "",
      `Cookies:  ${fs.existsSync(COOKIES_PATH) ? "loaded" : "MISSING — see setup below"}`,
      `bgutil:   ${BGUTIL_URL ? `${BGUTIL_URL}` : "not configured"}`,
      `yt-dlp:   ${fs.existsSync(YTDLP_PATH) ? "ready" : "not downloaded"}`,
      `ffmpeg:   ${fs.existsSync(FFMPEG_PATH) ? "ready" : "not downloaded"}`,
      `Node.js:  ${NODE_PATH}`,
      "",
      "=== Cookie Setup (required for YouTube) ===",
      "",
      "Your cookies have EXPIRED — YouTube rotated them.",
      "You need to re-export them from your browser.",
      "",
      "1. Install 'Get cookies.txt LOCALLY' Chrome extension:",
      "   https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
      "",
      "2. Go to youtube.com — make sure you are LOGGED IN",
      "",
      "3. Click the extension icon → click 'Export' or the youtube.com row",
      "   A .txt file downloads to your computer",
      "",
      "4. Open the .txt file in Notepad, press Ctrl+A, Ctrl+C",
      "",
      "5. Railway → your main service → Variables → YOUTUBE_COOKIES",
      "   Delete old value → Paste new value → Save",
      "   Railway redeploys automatically (~1 min)",
      "",
      "=== bgutil PO Token (auto-handles bot checks) ===",
      `Status: ${BGUTIL_URL ? "configured" : "NOT SET"}`,
      "BGUTIL_URL should be: http://bgutil-ytdlp-pot-provider.railway.internal:4416",
    ].join("\n"));
  });

  // GET /formats?url=
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).json({ error: "yt-dlp not ready — wait 30s" });

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${getJsRuntimeFlag()} ` +
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
      res.status(500).json({ error: err.message });
    }
  });

  // GET /download?url=&formatId=&title=
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).send("yt-dlp not ready");

    // Preserve the full title — only strip characters that break file systems
    // Allow: letters, numbers, spaces, hyphens, parentheses, brackets, dots, commas, apostrophes
    // Remove: / \ : * ? " < > | (illegal on Windows/Linux/Mac)
    const safeTitle = (title || "download")
      .replace(/[/\\:*?"<>|]/g, "")   // remove filesystem-illegal chars
      .replace(/\s+/g, " ")            // collapse multiple spaces
      .trim()
      .slice(0, 200)                   // cap length
      || "download";
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
          ...getJsRuntimeArgs(),
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
      const mimeMap  = { mp4: "video/mp4", webm: "video/webm", m4a: "audio/m4a", mp3: "audio/mpeg", ogg: "audio/ogg" };
      const mime     = mimeMap[ext] || "application/octet-stream";
      const stat     = fs.statSync(filePath);

      // RFC 5987 encoding — supports full Unicode titles (Arabic, Japanese, emoji, etc.)
      const asciiName   = safeTitle.replace(/[^\x20-\x7E]/g, "_");  // ASCII fallback
      const encodedName = encodeURIComponent(`${safeTitle}.${ext}`);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiName}.${ext}"; filename*=UTF-8''${encodedName}`
      );
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", () => { try { fs.unlinkSync(filePath); } catch (_) {} });

    } catch (err) {
      console.error("download error:", err.message);
      if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`\n  Speech Studio backend on port ${PORT}`);
    console.log(`  Cookies: ${fs.existsSync(COOKIES_PATH) ? "loaded" : "MISSING"}`);
    console.log(`  bgutil:  ${BGUTIL_URL || "not configured"}`);
    console.log(`  ffmpeg:  ${fs.existsSync(FFMPEG_PATH) ? "ready" : "not ready"}`);
    console.log(`  Node:    ${NODE_PATH}\n`);
  });
}

boot();
