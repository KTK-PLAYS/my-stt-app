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

// ── binary paths (all in /tmp — always writable on Railway) ──
const YTDLP_PATH   = "/tmp/yt-dlp";
const FFMPEG_PATH  = "/tmp/ffmpeg";
const COOKIES_PATH = "/tmp/yt-cookies.txt";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── generic exec helper ───────────────────────────────────────
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

// ── generic binary downloader (follows redirects, no curl/wget needed) ──
function downloadBinary(url, destPath, label) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      console.log(`${label} already exists at ${destPath}`);
      resolve();
      return;
    }

    console.log(`Downloading ${label} from GitHub...`);
    const file = fs.createWriteStream(destPath);

    function fetch(fetchUrl, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = fetchUrl.startsWith("https") ? https : require("http");
      mod.get(fetchUrl, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          fetch(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${label}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          fs.chmodSync(destPath, "755");
          console.log(`${label} downloaded and made executable`);
          resolve();
        });
      }).on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    fetch(url);
  });
}

// ── write YouTube cookies from env variable ───────────────────
function setupCookies() {
  const data = process.env.YOUTUBE_COOKIES;
  if (data && data.trim()) {
    fs.writeFileSync(COOKIES_PATH, data, "utf8");
    console.log("YouTube cookies written to", COOKIES_PATH);
  } else {
    console.warn("YOUTUBE_COOKIES env not set — YouTube may block some requests");
  }
}

// ── boot ──────────────────────────────────────────────────────
async function boot() {
  setupCookies();

  // 1. yt-dlp standalone binary (no Python needed)
  try {
    await downloadBinary(
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
      YTDLP_PATH,
      "yt-dlp"
    );
    const v = await run(`"${YTDLP_PATH}" --version`);
    console.log(`yt-dlp version: ${v}`);
  } catch (e) {
    console.error("yt-dlp setup failed:", e.message);
  }

  // 2. ffmpeg static binary — downloaded from johnvansickle.com builds
  //    These are pre-compiled, single-file, no dependencies, ~70MB.
  //    We grab only the ffmpeg binary out of the tar archive using Node streams.
  try {
    if (fs.existsSync(FFMPEG_PATH)) {
      console.log("ffmpeg already exists at", FFMPEG_PATH);
    } else {
      console.log("Downloading ffmpeg static binary...");
      await downloadFfmpeg();
    }
    const fv = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`);
    console.log(`ffmpeg: ${fv}`);
  } catch (e) {
    console.error("ffmpeg setup failed:", e.message);
    console.warn("Downloads will work but video+audio won't be merged (no ffmpeg).");
  }

  startServer();
}

// ── download & extract just the ffmpeg binary from the static build ──
function downloadFfmpeg() {
  return new Promise((resolve, reject) => {
    // johnvansickle.com hosts static musl builds — single tar.xz containing ffmpeg + ffprobe
    const tarUrl =
      "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";

    // We'll stream → gunzip/unxz → tar extract → pick the ffmpeg file
    // Node doesn't have native xz support so we pipe through the system `tar` command.
    // Railway containers have `tar` and `xz` even on minimal images.
    const cmd =
      `curl -sL "${tarUrl}" | tar -xJ --wildcards --no-anchored "*/ffmpeg" ` +
      `-O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;

    exec(cmd, { timeout: 180000, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // curl not available — fall back to pure Node https stream + system tar
        console.log("curl not found, trying Node https stream...");
        downloadFfmpegNodeStream().then(resolve).catch(reject);
        return;
      }
      console.log("ffmpeg extracted successfully");
      resolve();
    });
  });
}

// ── pure-Node fallback: download tar.xz then extract with child tar ──
function downloadFfmpegNodeStream() {
  return new Promise((resolve, reject) => {
    const tarUrl =
      "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
    const tmpTar = "/tmp/ffmpeg.tar.xz";
    const file   = fs.createWriteStream(tmpTar);

    console.log("Streaming ffmpeg tar.xz...");

    function fetch(url, hops = 0) {
      if (hops > 8) { reject(new Error("Too many redirects")); return; }
      const mod = url.startsWith("https") ? https : require("http");
      mod.get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          fetch(res.headers.location, hops + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ffmpeg tar`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log("tar.xz downloaded, extracting ffmpeg...");
          const cmd =
            `tar -xJf "${tmpTar}" --wildcards --no-anchored "*/ffmpeg" ` +
            `-O > "${FFMPEG_PATH}" && chmod 755 "${FFMPEG_PATH}"`;
          exec(cmd, { timeout: 120000 }, (err) => {
            try { fs.unlinkSync(tmpTar); } catch {}
            if (err) { reject(err); return; }
            console.log("ffmpeg extracted successfully");
            resolve();
          });
        });
      }).on("error", reject);
    }

    fetch(tarUrl);
  });
}

// ── helpers ───────────────────────────────────────────────────
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

// ── server ────────────────────────────────────────────────────
function startServer() {

  app.get("/ping",   (_, res) => res.json({ ok: true }));
  app.get("/health", (_, res) => res.json({ ok: true }));

  // Diagnostic — visit /check to see binary status
  app.get("/check", async (req, res) => {
    const r = {
      ytdlp:  { path: YTDLP_PATH,  exists: fs.existsSync(YTDLP_PATH)  },
      ffmpeg: { path: FFMPEG_PATH, exists: fs.existsSync(FFMPEG_PATH) },
      cookies: fs.existsSync(COOKIES_PATH),
    };
    try { r.ytdlp.version  = await run(`"${YTDLP_PATH}" --version`); }         catch (e) { r.ytdlp.version  = e.message; }
    try { r.ffmpeg.version = await run(`"${FFMPEG_PATH}" -version 2>&1 | head -1`); } catch (e) { r.ffmpeg.version = e.message; }
    res.json(r);
  });

  // ── GET /formats?url= ─────────────────────────────────────
  app.get("/formats", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "No URL provided" });
    if (!fs.existsSync(YTDLP_PATH))
      return res.status(503).json({ error: "yt-dlp not ready yet." });

    try {
      const raw = await run(
        `"${YTDLP_PATH}" --dump-json --no-playlist ` +
        `--no-check-certificates --extractor-retries 3 ` +
        `--user-agent "${USER_AGENT}" ` +
        `--add-header "Accept-Language:en-US,en;q=0.9" ` +
        `${getCookieFlag()} ` +
        `${getFfmpegFlag()} ` +
        `"${url}"`
      );

      const info = JSON.parse(raw);

      const ffmpegAvailable = fs.existsSync(FFMPEG_PATH);

      const seen = new Set();
      const formats = (info.formats || [])
        .filter(f => {
          if (!f.ext) return false;
          // Without ffmpeg we can only serve pre-muxed formats (have both video+audio)
          // or pure audio. We filter out video-only streams when ffmpeg is absent.
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
            id:        f.format_id,
            label,
            isAudio,
            hasAudio:  f.acodec !== "none",
            filesize:  f.filesize || f.filesize_approx || null,
            res:       isAudio ? 0 : (f.height || 0),
          };
        })
        .filter(f => {
          if (seen.has(f.label)) return false;
          seen.add(f.label);
          return true;
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
        // If ffmpeg available: merge best video + best audio
        // If no ffmpeg: download the format as-is (pre-muxed or audio-only)
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
        ];

        // Only request mp4 merge if ffmpeg is present
        if (ffmpeg) {
          args.push("--merge-output-format", "mp4");
        }

        args.push("-o", outPath, url);

        console.log("Downloading:", url, "| format:", formatId, "| ffmpeg:", ffmpeg);
        const proc = spawn(YTDLP_PATH, args);
        proc.stderr.on("data", d => process.stderr.write(d));
        proc.on("close", code =>
          code === 0 ? resolve() : reject(new Error(`yt-dlp exited ${code}`))
        );
      });

      // Find the output file (could be .mp4, .webm, .m4a, etc.)
      const allFiles = fs.readdirSync(os.tmpdir())
        .filter(f => f.startsWith(`ststudio-${stamp}`));
      const outFile = allFiles.sort().pop();
      if (!outFile) throw new Error("Output file not found after download");

      const filePath = path.join(os.tmpdir(), outFile);
      const ext      = path.extname(outFile).replace(".", "") || "mp4";
      const mimeMap  = { mp4:"video/mp4", webm:"video/webm", m4a:"audio/m4a", mp3:"audio/mpeg", ogg:"audio/ogg" };
      const mime     = mimeMap[ext] || "application/octet-stream";
      const stat     = fs.statSync(filePath);

      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.${ext}"`);
      res.setHeader("Content-Type",        mime);
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
    console.log(`\n Speech Studio Server running on port ${PORT}\n`);
  });
}

// start
boot();
