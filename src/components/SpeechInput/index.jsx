import React, {
  useState, useCallback, useEffect, useRef,
} from "react";
import { useWebSpeech } from "./useWebSpeech";
import { useWhisper }   from "./useWhisper";
import "./SpeechInput.css";

const STORAGE_KEY = "stt_transcript";

// ── detect browser ──────────────────────────────────────────
function getBrowserInfo() {
  const ua = navigator.userAgent;
  const isMobile  = /Android|iPhone|iPad|iPod/i.test(ua);
  const isChrome  = /Chrome/i.test(ua) && !/Edg/i.test(ua) && !/OPR/i.test(ua);
  const isEdge    = /Edg/i.test(ua);
  const isSafari  = /Safari/i.test(ua) && !/Chrome/i.test(ua);
  const isFirefox = /Firefox/i.test(ua);
  const isSupported = "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
  return { isMobile, isChrome, isEdge, isSafari, isFirefox, isSupported };
}

const LOADING_TIPS = [
  "Tip: Speak clearly and at a natural pace for the best results.",
  "Tip: You can pause and resume anytime without losing your transcript.",
  "Tip: Your transcript is saved automatically — even if you refresh.",
  "Tip: Use the Download button to save your transcript as a text file.",
  "Tip: The font size controls let you adjust readability.",
  "Tip: Use the Search button to find any word in your transcript.",
  "Tip: Press Space to pause or resume while recording.",
  "Tip: Works great for meeting notes, dictation, and voice memos.",
];

// ── loading screen component ────────────────────────────────
function LoadingScreen({ phase, progress, browserInfo }) {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex(i => (i + 1) % LOADING_TIPS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const phaseLabel =
    phase === "downloading" ? "Downloading speech engine…"
    : phase === "preparing" ? "Almost ready, setting things up…"
    : "Finishing up…";

  const phaseDetail =
    phase === "downloading"
      ? "We're downloading a small AI model to your browser. This only happens once — future visits will be instant."
      : "The engine is initialising. Just a few more seconds.";

  return (
    <div className="stt-loading-screen">
      <div className="stt-loading-icon">
        <WaveIcon />
      </div>

      <h2 className="stt-loading-title">Setting up your speech engine</h2>
      <p className="stt-loading-detail">{phaseDetail}</p>

      {/* progress bar */}
      <div className="stt-loading-bar-track">
        <div
          className="stt-loading-bar-fill"
          style={{ width: `${phase === "preparing" ? 95 : progress}%` }}
        />
      </div>
      <div className="stt-loading-pct">
        {phase === "preparing" ? "Preparing…" : `${Math.round(progress)}%`}
      </div>

      {/* rotating tip */}
      <div className="stt-loading-tip">
        <span className="stt-loading-tip-label">Did you know?</span>
        <span>{LOADING_TIPS[tipIndex]}</span>
      </div>

      {/* browser suggestion */}
      {browserInfo.isFirefox && (
        <div className="stt-loading-suggestion">
          <InfoIcon />
          <span>
            For an even faster experience with no loading time, this feature
            works instantly on <strong>Chrome</strong> or <strong>Edge</strong>.
          </span>
        </div>
      )}
    </div>
  );
}

// ── permission denied screen ────────────────────────────────
function PermissionScreen({ onRetry }) {
  return (
    <div className="stt-loading-screen">
      <div className="stt-loading-icon" style={{ color: "#D85A30" }}>
        <MicOffIcon />
      </div>
      <h2 className="stt-loading-title">Microphone access needed</h2>
      <p className="stt-loading-detail">
        To use speech-to-text, your browser needs permission to use your
        microphone. Please click the lock icon in your address bar and set
        Microphone to <strong>Allow</strong>, then try again.
      </p>
      <button className="stt-btn stt-btn--primary" onClick={onRetry}
        style={{ marginTop: "1rem" }}>
        Try again
      </button>
    </div>
  );
}

// ── mobile warning banner ───────────────────────────────────
function MobileBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="stt-mobile-banner">
      <InfoIcon />
      <span>
        Speech recognition works on mobile, but for the best experience
        we recommend using a desktop browser.
      </span>
      <button className="stt-banner-close" onClick={() => setDismissed(true)}>✕</button>
    </div>
  );
}

// ── main component ──────────────────────────────────────────
export default function SpeechInput({ onTranscript, placeholder }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused,    setIsPaused]    = useState(false);
  const [allText,     setAllText]     = useState(
    () => localStorage.getItem(STORAGE_KEY) || ""
  );
  const [interimText, setInterimText] = useState("");
  const [engine,      setEngine]      = useState(null);
  const [copied,      setCopied]      = useState(false);
  const [fontSize,    setFontSize]    = useState(15);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [elapsed,     setElapsed]     = useState(0);
  const [screen,      setScreen]      = useState("main");
  // screen: main | loading | permission

  const [whisperStatus, setWhisperStatus] = useState({ phase: "idle", progress: 0 });
  const [browserInfo]   = useState(() => getBrowserInfo());

  const accumulatedRef = useRef(localStorage.getItem(STORAGE_KEY) || "");
  const textBoxRef     = useRef(null);
  const timerRef       = useRef(null);
  const searchRef      = useRef(null);

  // ── auto-scroll ──
  useEffect(() => {
    if (!searchQuery && textBoxRef.current) {
      textBoxRef.current.scrollTop = textBoxRef.current.scrollHeight;
    }
  }, [allText, interimText, searchQuery]);

  // ── persist ──
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, allText);
    onTranscript?.(allText);
  }, [allText]);

  // ── timer ──
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording, isPaused]);

  // ── spacebar shortcut ──
  useEffect(() => {
    const handler = (e) => {
      if (e.code === "Space" && e.target === document.body && isRecording) {
        e.preventDefault();
        isPaused ? handleResume() : handlePause();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isRecording, isPaused]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

const handleResult = useCallback(({ final, interim }) => {
  if (final && final.trim()) {
    if (engine === "webspeech") {
      accumulatedRef.current = final;
      setAllText(final);
    } else {
      const sep = accumulatedRef.current ? " " : "";
      accumulatedRef.current = accumulatedRef.current + sep + final.trim();
      setAllText(accumulatedRef.current);
    }
  }
  setInterimText(interim || "");
}, [engine]);

  const handleEnd = useCallback((reason) => {
    if (reason === "permission") setScreen("permission");
  }, []);

  const handleWhisperStatus = useCallback((status) => {
    setWhisperStatus(status);
    if (status.phase === "ready" && screen === "loading") {
      // small delay so user sees 100% briefly before transition
      setTimeout(() => setScreen("main"), 600);
    }
  }, [screen]);

  const webSpeech = useWebSpeech({ onResult: handleResult, onEnd: handleEnd });
  const whisper   = useWhisper({
    onResult: handleResult,
    onStatusChange: handleWhisperStatus,
  });

  // ── engine detection on mount ──
  useEffect(() => {
    if (webSpeech.isSupported) {
      setEngine("webspeech");
      // instantly ready — no loading screen needed
    } else {
      setEngine("whisper");
      setScreen("loading");
      whisper.load(); // start background download immediately
    }
  }, []);

  // ── transition loading → main when whisper ready ──
  useEffect(() => {
    if (whisperStatus.phase === "ready" && screen === "loading") {
      setTimeout(() => setScreen("main"), 600);
    }
  }, [whisperStatus.phase, screen]);
// ── mic sounds — only on deliberate user clicks ──
const playSound = (type) => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === "on") {
    // two rising tones — feels like "activating"
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } else {
    // two falling tones — feels like "deactivating"
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  }
};
  const handleStart = async () => {
    try {
      playSound("on");
      setIsPaused(false);
      if (engine === "webspeech") {
        webSpeech.start();
      } else {
        await whisper.start();
      }
      setIsRecording(true);
      setInterimText("");
    } catch (err) {
      if (err.name === "NotAllowedError") setScreen("permission");
    }
  };

  const handlePause = () => {
    engine === "webspeech" ? webSpeech.stop() : whisper.stop();
    setIsPaused(true);
    setInterimText("");
  };

  const handleResume = async () => {
    setIsPaused(false);
    engine === "webspeech" ? webSpeech.start() : await whisper.start();
    setInterimText("");
  };

  const handleStop = () => {
    playSound("off");
    engine === "webspeech" ? webSpeech.stop() : whisper.stop();
    setIsRecording(false);
    setIsPaused(false);
    setInterimText("");
    setElapsed(0);
  };

  const handleClear = () => {
    if (!window.confirm("Clear all transcript text? This cannot be undone.")) return;
    accumulatedRef.current = "";
    setAllText("");
    setInterimText("");
    setElapsed(0);
    localStorage.removeItem(STORAGE_KEY);
    webSpeech.resetCommitted();
  };

  const handleCopy = () => {
    if (!allText) return;
    navigator.clipboard.writeText(allText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!allText) return;
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([allText], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `transcript-${date}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const renderText = () => {
    if (!searchQuery.trim() || !allText) {
      return <span className="stt-final">{allText}</span>;
    }
    const regex = new RegExp(
      `(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"
    );
    return allText.split(regex).map((part, i) =>
      regex.test(part)
        ? <mark key={i} className="stt-highlight">{part}</mark>
        : <span key={i}>{part}</span>
    );
  };

  const wordCount = allText
    ? allText.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = allText.length;

  const formatTime = (s) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── RENDER: loading screen ──
  if (screen === "loading") {
    return (
      <div className="stt-wrap">
        <LoadingScreen
          phase={whisperStatus.phase}
          progress={whisperStatus.progress}
          browserInfo={browserInfo}
        />
      </div>
    );
  }

  // ── RENDER: permission denied ──
  if (screen === "permission") {
    return (
      <div className="stt-wrap">
        <PermissionScreen onRetry={() => setScreen("main")} />
      </div>
    );
  }

  // ── RENDER: main interface ──
  return (
    <div className="stt-wrap">

      {browserInfo.isMobile && <MobileBanner />}

      {/* top bar */}
      <div className="stt-topbar">
        <div className="stt-topbar-left">
          {isRecording && !isPaused && <span className="stt-dot" />}
          <span className="stt-status">
            {isRecording && !isPaused ? "Listening"
              : isPaused ? "Paused"
              : allText  ? "Ready"
              : "Ready to record"}
          </span>
          {isRecording && (
            <span className="stt-timer">{formatTime(elapsed)}</span>
          )}
        </div>
        <div className="stt-topbar-right">
          <span className="stt-meta">{wordCount} words</span>
          <span className="stt-meta stt-meta--faint">{charCount} chars</span>
          <span className="stt-engine-badge">
            {engine === "webspeech" ? "Web Speech" : "Whisper AI"}
          </span>
        </div>
      </div>

      {/* toolbar */}
      <div className="stt-toolbar">
        <div className="stt-toolbar-group">
          <button className="stt-tool-btn" title="Decrease font"
            onClick={() => setFontSize(f => Math.max(11, f - 1))}>A−</button>
          <span className="stt-tool-label">{fontSize}px</span>
          <button className="stt-tool-btn" title="Increase font"
            onClick={() => setFontSize(f => Math.min(24, f + 1))}>A+</button>
        </div>
        <div className="stt-toolbar-group">
          <button
            className={`stt-tool-btn ${searchOpen ? "stt-tool-btn--active" : ""}`}
            onClick={() => { setSearchOpen(o => !o); if (searchOpen) setSearchQuery(""); }}
          >
            <SearchIcon /> Search
          </button>
        </div>
      </div>

      {/* search bar */}
      {searchOpen && (
        <div className="stt-search-bar">
          <SearchIcon />
          <input
            ref={searchRef}
            className="stt-search-input"
            placeholder="Search in transcript…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="stt-search-clear"
              onClick={() => setSearchQuery("")}>✕</button>
          )}
        </div>
      )}

      {/* text box — limitless */}
      <div ref={textBoxRef} className="stt-display" style={{ fontSize }}>
        {!allText && !interimText && (
          <span className="stt-placeholder">
            {placeholder || "Click Start recording and begin speaking — your words will appear here in real time…"}
          </span>
        )}
        {renderText()}
        {interimText && (
          <span className="stt-interim"> {interimText}</span>
        )}
      </div>

      {/* controls */}
      <div className="stt-controls">
        {!isRecording && (
          <button className="stt-btn stt-btn--primary" onClick={handleStart}>
            <MicIcon /> Start recording
          </button>
        )}
        {isRecording && !isPaused && (
          <button className="stt-btn stt-btn--amber" onClick={handlePause}>
            <PauseIcon /> Pause
          </button>
        )}
        {isRecording && isPaused && (
          <button className="stt-btn stt-btn--primary" onClick={handleResume}>
            <MicIcon /> Resume
          </button>
        )}
        {isRecording && (
          <button className="stt-btn stt-btn--danger" onClick={handleStop}>
            <StopIcon /> Stop
          </button>
        )}
        <div className="stt-controls-right">
          <button className="stt-btn stt-btn--ghost"
            onClick={handleCopy} disabled={!allText}>
            {copied ? <TickIcon /> : <CopyIcon />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button className="stt-btn stt-btn--ghost"
            onClick={handleDownload} disabled={!allText}>
            <DownloadIcon /> Download
          </button>
          <button className="stt-btn stt-btn--ghost stt-btn--destructive"
            onClick={handleClear} disabled={!allText}>
            <TrashIcon /> Clear
          </button>
        </div>
      </div>

      {isRecording && (
        <div className="stt-hint">
          Press <kbd>Space</kbd> to {isPaused ? "resume" : "pause"}
        </div>
      )}

    </div>
  );
}

// ── icons ───────────────────────────────────────────────────
function MicIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
}
function MicOffIcon() {
  return <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
}
function PauseIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
}
function StopIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>;
}
function CopyIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
}
function TickIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><polyline points="20 6 9 17 4 12"/></svg>;
}
function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}
function SearchIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function InfoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
}
function WaveIcon() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-2" /></svg>;
}