/**
 * server.cjs  —  Speech Studio Media Backend
 * ─────────────────────────────────────────────────────────────────
 * Deploy on Railway. Set these env variables in Railway dashboard:
 *
 *   PORT              → set automatically by Railway
 *   YOUTUBE_COOKIES   → (optional, legacy) Netscape cookie file content
 *   YT_TOKEN_DATA     → (auto-managed) stores OAuth2 token JSON — Railway
 *                       will update this automatically via the /save-token
 *                       endpoint the first time you authenticate.
 *
 * FIRST-TIME OAUTH SETUP (one time only):
 *   1. Deploy this server to Railway
 *   2. Visit  https://your-railway-url.up.railway.app/auth-url
 *   3. Follow the printed instructions to get the token
 *   4. Done — the token auto-refreshes from then on
 * ─────────────────────────────────────────────────────────────────
 */

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

// ── binary + token paths ──────────────────────────────────────
const YTDLP_PATH   = "/tmp/yt-dlp";
const FFMPEG_PATH  = "/tmp/ffmpeg";
const COOKIES_PATH = "/tmp/yt-cookies.txt";
const TOKEN_PATH   = "/tmp/yt-oauth.json";   // yt-dlp token cache file

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

// ── binary downloader ─────────────────────────────────────────
function downloadBinary(url, destPath, label) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) { console.log(`${label} already cached`); resolve(); return; }
    console.log(`Downloading ${label}…`);
    const file = fs.createWriteStream(destPath);
    function fetch(fetchUrl, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = fetchUrl.startsWith("https") ? https : require("http");
      mod.get(fetchUrl, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location, hops+1); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${label}`)); return; }
        res.pipe(file);
        file.on("finish", () => { file.close(); fs.chmodSync(destPath,"755"); console.log(`${label} ready`); resolve(); });
      }).on("error", (e) => { fs.unlink(destPath,()=>{}); reject(e); });
    }
    fetch(url);
  });
}

// ─────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
//
// yt-dlp OAuth2 stores a JSON token file at TOKEN_PATH.
// We persist this between Railway deploys by:
//   1. On boot  → restore token file from YT_TOKEN_DATA env var
//   2. After each download → if the token file changed, update the
//      env var via Railway API (requires RAILWAY_TOKEN + service ID)
//      OR just log the new content so you can copy-paste it once.
// ─────────────────────────────────────────────────────────────

function restoreToken() {
  const data = process.env.YT_TOKEN_DATA;
  if (data && data.trim()) {
    try {
      // Validate it parses as JSON before writing
      JSON.parse(data);
      fs.writeFileSync(TOKEN_PATH, data, "utf8");
      console.log("✅ OAuth token restored from YT_TOKEN_DATA env var");
    } catch {
      console.warn("⚠️  YT_TOKEN_DATA is set but is not valid JSON — ignoring");
    }
  } else {
    console.warn("ℹ️  YT_TOKEN_DATA not set — YouTube may require auth. Visit /auth-url to set up.");
  }
}

// Read the current token file and return its content (or null)
function readToken() {
  try {
    if (fs.existsSync(TOKEN_PATH)) return fs.readFileSync(TOKEN_PATH, "utf8");
  } catch {}
  return null;
}

// Called after every yt-dlp run to capture any refreshed token
async function persistTokenIfChanged(previousTokenData) {
  const current = readToken();
  if (!current) return;
  if (current === previousTokenData) return; // unchanged

  console.log("\n🔄 OAuth token was refreshed by yt-dlp");

  // ── Option A: Railway API auto-update ─────────────────────
  // If you set RAILWAY_API_TOKEN + RAILWAY_SERVICE_ID in Railway dashboard,
  // the token env var is updated automatically without any manual step.
  const railwayToken   = process.env.RAILWAY_API_TOKEN;
  const railwayService = process.env.RAILWAY_SERVICE_ID;
  const railwayEnvId   = process.env.RAILWAY_ENVIRONMENT_ID || "production";

  if (railwayToken && railwayService) {
    try {
      await updateRailwayEnvVar("YT_TOKEN_DATA", current, railwayToken, railwayService, railwayEnvId);
      console.log("✅ YT_TOKEN_DATA updated in Railway automatically");
    } catch (e) {
      console.warn("⚠️  Railway auto-update failed:", e.message);
      logTokenForManualCopy(current);
    }
  } else {
    // ── Option B: Just log it so you can copy-paste once ──
    logTokenForManualCopy(current);
  }
}

function logTokenForManualCopy(tokenData) {
  console.log("\n════════════════════════════════════════════════");
  console.log("TOKEN REFRESHED — copy the value below into");
  console.log("Railway dashboard → Variables → YT_TOKEN_DATA:");
  console.log("────────────────────────────────────────────────");
  console.log(tokenData);
  console.log("════════════════════════════════════════════════\n");
}

// ── Railway Variables API (GraphQL) ──────────────────────────
function updateRailwayEnvVar(name, value, apiToken, serviceId, environmentId) {
  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      query: `mutation variableUpsert($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }`,
      variables: {
        input: {
          projectId:     process.env.RAILWAY_PROJECT_ID || "",
          serviceId,
          environmentId,
          name,
          value,
        },
      },
    });

    const options = {
      hostname: "backboard.railway.app",
      path:     "/graphql/v2",
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${apiToken}`,
        "Content-Length": Buffer.byteLength(query),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
          else resolve(parsed);
        } catch { reject(new Error("Invalid Railway API response")); }
      });
    });
    req.on("error", reject);
    req.write(query);
    req.end();
  });
}

// ── setup cookies (legacy fallback) ──────────────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("Legacy YouTube cookies written");
  }
}

// ── auth args builder ─────────────────────────────────────────
// Prefers OAuth token file → falls back to cookies → falls back to nothing
function getAuthArgs() {
  if (fs.existsSync(TOKEN_PATH)) {
    return ["--username", "oauth2", "--password", "", "--cache-dir", "/tmp/yt-dlp-cache"];
  }
  if (fs.existsSync(COOKIES_PATH)) {
    return ["--cookies", COOKIES_PATH];
  }
  return [];
}

function getAuthFlag() {
  if (fs.existsSync(TOKEN_PATH)) {
    return `--username oauth2 --password "" --cache-dir /tmp/yt-dlp-cache`;
  }
  if (fs.existsSync(COOKIES_PATH)) {
    return `--cookies "${COOKIES_PATH}"`;
  }
  return "";
}

function getFfmpegArgs() {
  return fs.existsSync(FFMPEG_PATH) ? ["--ffmpeg-location", FFMPEG_PATH] : [];
}

function getFfmpegFlag() {
  return fs.existsSync(FFMPEG_PATH) ? `--ffmpeg-location "${FFMPEG_PATH}"` : "";
}

// ─────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────
async function boot() {
  setupCookies();
  restoreToken();

  // 1. yt-dlp binary
  try {
    await downloadBinary(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      YTDLP_PATH, "yt-dlp"
    );
    const v = await run(`"${YTDLP_PATH}" --version`);
    console.log(`yt-dlp ${v}`);
  } catch (e) { console.error("yt-dlp setup failed:", e.message); }

  // 2. ffmpeg binary
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
    console.warn("ffmpeg unavailable — video+audio won't be merged:", e.message);
  }

  startServer();
}

// ── ffmpeg download ───────────────────────────────────────────
function downloadFfmpeg() {
  return new Promise((resolve, reject) => {
    const tarUrl =
      "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const cmd =
      `curl -sL "${tarUrl}" | tar -xJ --wildcards --no-anchored "*/ffmpeg" ` +
      `-O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
    exec(cmd, { timeout:180000, maxBuffer:100*1024*1024 }, (err) => {
      if (err) { downloadFfmpegNodeStream().then(resolve).catch(reject); return; }
      console.log("ffmpeg extracted"); resolve();
    });
  });
}

function downloadFfmpegNodeStream() {
  return new Promise((resolve, reject) => {
    const tarUrl = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const tmpTar = "/tmp/ffmpeg.tar.xz";
    const file   = fs.createWriteStream(tmpTar);
    function fetch(url, hops=0) {
      if (hops>8) { reject(new Error("Too many redirects")); return; }
      const mod = url.startsWith("https") ? https : require("http");
      mod.get(url, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) { fetch(res.headers.location,hops+1); return; }
        if (res.statusCode!==200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          const cmd = `tar -xJf "${tmpTar}" --wildcards --no-anchored "*/ffmpeg" -O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
          exec(cmd, {timeout:120000}, (err) => {
            try{fs.unlinkSync(tmpTar);}catch{}
            if (err) { reject(err); return; }
            console.log("ffmpeg extracted"); resolve();
          });
        });
      }).on("error", reject);
    }
    fetch(tarUrl);
  });
}

// ─────────────────────────────────────────────────────────────
// SERVER ROUTES
// ─────────────────────────────────────────────────────────────
function startServer() {

  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  // ── /check — binary + auth status ───────────────────────
  app.get("/check", async (_, res) => {
    const r = {
      ytdlp:    { path: YTDLP_PATH,   exists: fs.existsSync(YTDLP_PATH)   },
      ffmpeg:   { path: FFMPEG_PATH,  exists: fs.existsSync(FFMPEG_PATH)  },
      oauthToken: {
        path:   TOKEN_PATH,
        exists: fs.existsSync(TOKEN_PATH),
        envSet: !!process.env.YT_TOKEN_DATA,
      },
      cookies:  fs.existsSync(COOKIES_PATH),
    };
    try { r.ytdlp.version  = await run(`"${YTDLP_PATH}" --version`); }          catch(e){ r.ytdlp.error  = e.message; }
    try { r.ffmpeg.version = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`); } catch(e){ r.ffmpeg.error = e.message; }
    if (r.oauthToken.exists) {
      try { r.oauthToken.data = JSON.parse(readToken()); } catch { r.oauthToken.parseError = true; }
    }
    res.json(r);
  });

  // ── /auth-url — cookie setup guide ────────────────────────
  app.get("/auth-url", (req, res) => {
    const cookieStatus = fs.existsSync(COOKIES_PATH) ? "LOADED (may be expired)" : "NOT SET";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      "=== YouTube Cookie Setup Guide ===",
      "",
      "YouTube no longer supports OAuth in yt-dlp.",
      "You need to export cookies from your browser. Here is how:",
      "",
      "STEP 1 — Install a browser extension:",
      "  Chrome/Edge: search 'Get cookies.txt LOCALLY' in Chrome Web Store",
      "  Link: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
      "  Firefox: search 'cookies.txt' in Firefox Add-ons",
      "",
      "STEP 2 — Export cookies:",
      "  Go to youtube.com and make sure you are LOGGED IN to your Google account",
      "  Click the extension icon in the toolbar",
      "  Click 'Export' or 'Download cookies for this tab'",
      "  A .txt file will download to your computer",
      "",
      "STEP 3 — Add to Railway:",
      "  Open the .txt file in Notepad (Windows) or TextEdit (Mac)",
      "  Select ALL the text (Ctrl+A or Cmd+A) and Copy",
      "  Go to Railway → your service → Variables tab",
      "  Find YOUTUBE_COOKIES → paste as the value → click Save",
      "  Railway will redeploy automatically (takes ~1 minute)",
      "",
      "STEP 4 — Test it:",
      "  Visit: /check  to confirm cookies are loaded",
      "  Try a download to confirm it works",
      "",
      "NOTE: YouTube cookies expire every few weeks.",
      "When downloads start failing, just repeat steps 2-3 with fresh cookies.",
      "",
      "Current status:",
      "  Cookies: " + cookieStatus,
      "  yt-dlp:  " + (fs.existsSync(YTDLP_PATH) ? "ready" : "not downloaded"),
      "  ffmpeg:  " + (fs.existsSync(FFMPEG_PATH) ? "ready" : "not downloaded"),
    ].join("\n"));
  });

  // ── /save-token  POST { token: "..." } ──────────────────
  // Manually post a token JSON string to save it (and update env var)
  app.post("/save-token", async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Missing token field" });
    try {
      JSON.parse(token); // validate
      fs.writeFileSync(TOKEN_PATH, token, "utf8");
      await persistTokenIfChanged("__force_update__"); // always persist
      res.json({ ok: true, message: "Token saved and persisted" });
    } catch (e) {
      res.status(400).json({ error: "Invalid JSON token: " + e.message });
    }
  });

  // ── GET /formats?url= ───────────────────────────────────
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).json({ error: "yt-dlp not ready yet." });

    const prevToken = readToken();

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${getAuthFlag()} ` +
        `${getFfmpegFlag()} ` +
        `"${url}"`
      );

      // Persist token if yt-dlp refreshed it during this request
      persistTokenIfChanged(prevToken).catch(e => console.warn("Token persist error:", e.message));

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
          const resolution = isAudio ? "audio" : (f.resolution || (f.height ? f.height+"p" : "unknown"));
          const label      = isAudio
            ? `Audio — ${f.ext.toUpperCase()}${f.abr ? " "+Math.round(f.abr)+"kbps" : ""}`.trim()
            : `${resolution} — ${f.ext.toUpperCase()}${f.fps ? " "+f.fps+"fps" : ""}`.trim();
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

  // ── GET /download?url=&formatId=&title= ─────────────────
  app.get("/download", async (req, res) => {
    const { url, formatId, title } = req.query;
    if (!url || !formatId) return res.status(400).send("Missing url or formatId");
    if (!fs.existsSync(YTDLP_PATH)) return res.status(503).send("yt-dlp not ready.");

    const prevToken = readToken();
    const safeTitle = (title || "download").replace(/[^\w\s-]/g,"").trim() || "download";
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
          ...getAuthArgs(),
          ...getFfmpegArgs(),
        ];

        if (ffmpeg) args.push("--merge-output-format", "mp4");

        args.push("-o", outPath, url);

        console.log(`Downloading: ${url} | format: ${formatId} | ffmpeg: ${ffmpeg}`);
        const proc = spawn(YTDLP_PATH, args);
        proc.stderr.on("data", d => process.stderr.write(d));
        proc.on("close", code => code===0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`)));
      });

      // Persist refreshed token after download
      persistTokenIfChanged(prevToken).catch(e => console.warn("Token persist error:", e.message));

      const allFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(`ststudio-${stamp}`));
      const outFile  = allFiles.sort().pop();
      if (!outFile) throw new Error("Output file not found after download");

      const filePath = path.join(os.tmpdir(), outFile);
      const ext      = path.extname(outFile).replace(".","") || "mp4";
      const mimeMap  = { mp4:"video/mp4",webm:"video/webm",m4a:"audio/m4a",mp3:"audio/mpeg",ogg:"audio/ogg" };
      const mime     = mimeMap[ext] || "application/octet-stream";
      const stat     = fs.statSync(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
      res.setHeader("Content-Type",        mime);
      res.setHeader("Content-Length",      stat.size);
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on("close", () => { try{fs.unlinkSync(filePath);}catch{} });

    } catch (err) {
      console.error("download error:", err.message);
      if (!res.headersSent) res.status(500).send("Download failed: " + err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`\n  🎙  Speech Studio backend on port ${PORT}\n`);
    console.log(`  Auth status: ${fs.existsSync(TOKEN_PATH) ? "✅ OAuth token loaded" : "⚠️  No token — visit /auth-url"}\n`);
  });
}

boot();
