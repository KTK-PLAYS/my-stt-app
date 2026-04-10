import React, { useState, useEffect, useRef, useCallback } from "react";
import SpeechInput from "./components/SpeechInput";

// ─────────────────────────────────────────────
// localStorage helper
// ─────────────────────────────────────────────
const LS = {
  get:    (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set:    (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k)     => { try { localStorage.removeItem(k); } catch {} },
};

function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────
function Modal({ open, onClose, title, children, dark }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,zIndex:200,
      background:"rgba(0,0,0,0.65)",backdropFilter:"blur(6px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:"100%",maxWidth:560,maxHeight:"82vh",overflowY:"auto",
        background: dark ? "#1b1c1a" : "#fff",
        border: `1px solid ${dark ? "rgba(61,74,65,0.3)" : "#e0dfd8"}`,
        borderRadius:20, padding:"28px 32px",
        color: dark ? "#e4e2df" : "#2c2c2a",
        fontFamily:"'Manrope',sans-serif",
      }}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <span style={{fontSize:18,fontWeight:700,letterSpacing:"-0.02em"}}>{title}</span>
          <button onClick={onClose} style={{border:"none",background:"none",cursor:"pointer",
            color:dark?"#869489":"#aaa",fontSize:22,lineHeight:1,padding:"2px 6px"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Help modal
// ─────────────────────────────────────────────
const FAQ = [
  { q:"How does speech recognition work?",
    a:"On Chrome, Edge and Safari your browser's built-in speech engine is used — instant and free. On Firefox a small AI model (Whisper ~39MB) downloads once to your device and runs fully locally." },
  { q:"Is my audio sent to any server?",
    a:"On Chrome/Edge/Safari audio is processed by Google or Apple servers. On Firefox the Whisper engine runs entirely on your device — nothing leaves your browser." },
  { q:"Why is there a loading screen on Firefox?",
    a:"Firefox has no built-in speech API so we download the Whisper AI model (~39MB) the first time. After that it is cached and loads instantly on every future visit." },
  { q:"What happens if I refresh the page?",
    a:"Your current transcript is saved to your browser automatically and restored on reload." },
  { q:"How do I save a session?",
    a:"Click Stop after recording. Your session saves automatically to Recent Dictations with title, date, word count and duration." },
  { q:"How do I pin a session?",
    a:"Go to Recent Dictations and click the pin icon on any entry. It moves to Pinned Transcripts. Click again to unpin." },
  { q:"What do templates do?",
    a:"Templates pre-fill the session title so your recordings stay organised by type. Click a template and you land on the Studio with the title already set." },
  { q:"Can I transcribe audio from a video?",
    a:"Install VB-Cable (Windows) or BlackHole (Mac) — free virtual audio drivers that route your system sound through a virtual microphone. Set it as your default mic and the studio will hear your video audio." },
  { q:"Is this free?",
    a:"Completely free. No account, no API key, no subscription. Runs entirely in your browser at zero cost." },
  { q:"How does the media downloader work?",
    a:"The Downloader tab lets you paste any video URL (YouTube, Twitter, Instagram, TikTok and 1000+ more), fetch all available quality options, then download the file directly to your device." },
];

function HelpModal({ open, onClose, dark }) {
  const [idx, setIdx] = useState(null);
  const c = { border:`1px solid ${dark?"rgba(61,74,65,0.25)":"#f0f0ee"}`,paddingBottom:12,marginBottom:12 };
  return (
    <Modal open={open} onClose={onClose} title="Help Centre" dark={dark}>
      <p style={{fontSize:13,color:dark?"#869489":"#888",marginBottom:20,lineHeight:1.6}}>
        Everything you need to know about The Speech Studio.
      </p>
      {FAQ.map((item,i) => (
        <div key={i} style={c}>
          <button onClick={() => setIdx(idx===i?null:i)} style={{
            width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",
            background:"none",border:"none",cursor:"pointer",
            color:dark?"#e4e2df":"#2c2c2a",fontFamily:"'Manrope',sans-serif",
            fontSize:14,fontWeight:600,textAlign:"left",padding:"4px 0",gap:12,
          }}>
            <span>{item.q}</span>
            <span style={{color:"#59de9b",flexShrink:0,fontSize:20,lineHeight:1}}>{idx===i?"−":"+"}</span>
          </button>
          {idx===i && (
            <p style={{fontSize:13,color:dark?"#bccabe":"#666",lineHeight:1.7,marginTop:8,paddingRight:20}}>
              {item.a}
            </p>
          )}
        </div>
      ))}
    </Modal>
  );
}

// ─────────────────────────────────────────────
// Settings modal
// ─────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width:46,height:25,borderRadius:999,border:"none",cursor:"pointer",
      position:"relative",flexShrink:0,
      background: checked ? "#59de9b" : "#444441",
      transition:"background .2s",
    }}>
      <span style={{
        position:"absolute",top:3,left:checked?22:3,width:19,height:19,
        borderRadius:"50%",background:"#fff",transition:"left .2s",display:"block",
      }}/>
    </button>
  );
}

function SRow({ label, sub, dark, children }) {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,
      padding:"14px 0",borderBottom:`1px solid ${dark?"rgba(61,74,65,0.2)":"#f0f0ee"}`}}>
      <div>
        <div style={{fontSize:14,fontWeight:600,color:dark?"#e4e2df":"#2c2c2a"}}>{label}</div>
        {sub && <div style={{fontSize:12,color:dark?"#869489":"#aaa",marginTop:2}}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function SettingsModal({ open, onClose, dark, settings, onChange, onClearHistory, onClearAll }) {
  const bs = () => ({
    padding:"7px 14px",borderRadius:8,
    border:`1px solid ${dark?"rgba(255,100,80,0.3)":"#ffa0a0"}`,
    background:"transparent",cursor:"pointer",
    fontFamily:"'Manrope',sans-serif",fontSize:12,fontWeight:600,
    color:dark?"#ffb4ab":"#c0392b",
  });
  return (
    <Modal open={open} onClose={onClose} title="Settings" dark={dark}>
      <SRow label="Dark mode" sub="Switch between dark and light interface" dark={dark}>
        <Toggle checked={dark} onChange={v => onChange("dark", v)}/>
      </SRow>
      <SRow label="Transcript font size" sub={`Currently ${settings.fontSize}px`} dark={dark}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={() => onChange("fontSize", Math.max(12, settings.fontSize-1))}
            style={{width:28,height:28,borderRadius:6,border:`1px solid ${dark?"rgba(61,74,65,0.4)":"#ddd"}`,
              background:"transparent",cursor:"pointer",fontSize:16,color:"#59de9b",fontWeight:700}}>−</button>
          <span style={{fontSize:13,fontWeight:700,minWidth:36,textAlign:"center",color:"#59de9b"}}>
            {settings.fontSize}px
          </span>
          <button onClick={() => onChange("fontSize", Math.min(28, settings.fontSize+1))}
            style={{width:28,height:28,borderRadius:6,border:`1px solid ${dark?"rgba(61,74,65,0.4)":"#ddd"}`,
              background:"transparent",cursor:"pointer",fontSize:16,color:"#59de9b",fontWeight:700}}>+</button>
        </div>
      </SRow>
      <SRow label="Auto-save sessions" sub="Save each recording to Recent Dictations on Stop" dark={dark}>
        <Toggle checked={settings.autoSave} onChange={v => onChange("autoSave", v)}/>
      </SRow>
      <SRow label="Mic sounds" sub="Play a tone when recording starts and stops" dark={dark}>
        <Toggle checked={settings.sounds} onChange={v => onChange("sounds", v)}/>
      </SRow>
      <SRow label="Recognition language" sub="Speech recognition language" dark={dark}>
        <select value={settings.lang} onChange={e => onChange("lang", e.target.value)} style={{
          background:dark?"#292a28":"#f5f5f3",
          border:`1px solid ${dark?"rgba(61,74,65,0.4)":"#e0dfd8"}`,
          borderRadius:8,padding:"6px 10px",fontSize:13,
          color:dark?"#e4e2df":"#2c2c2a",fontFamily:"'Manrope',sans-serif",cursor:"pointer",
        }}>
          <option value="en-US">English (US)</option>
          <option value="en-GB">English (UK)</option>
          <option value="en-AU">English (AU)</option>
        </select>
      </SRow>
      <div style={{marginTop:20,padding:16,borderRadius:10,
        background:dark?"rgba(255,100,80,0.04)":"#fff5f5",
        border:`1px solid ${dark?"rgba(255,100,80,0.15)":"#ffd5d5"}`}}>
        <div style={{fontSize:13,fontWeight:700,color:dark?"#ffb4ab":"#c0392b",marginBottom:12}}>
          Danger Zone
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button style={bs()} onClick={onClearHistory}>Clear all history</button>
          <button style={bs()} onClick={onClearAll}>Reset everything</button>
        </div>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// StopInterceptor
// ─────────────────────────────────────────────
function StopInterceptor({ onStart, onStop }) {
  const ref = useRef(null);
  useEffect(() => {
    const container = ref.current?.parentElement;
    if (!container) return;
    const handler = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const text = (btn.textContent || "").trim().toLowerCase();
      if (text.includes("start") || text.includes("resume")) onStart?.();
      if (text.includes("stop")) onStop?.();
    };
    container.addEventListener("click", handler, true);
    return () => container.removeEventListener("click", handler, true);
  }, [onStart, onStop]);
  return <div ref={ref} style={{display:"none"}}/>;
}

// ─────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────
const TEMPLATES = [
  { name:"Meeting Notes",      icon:"groups",             desc:"Attendees, agenda, decisions and action items.",      tag:"Business"     },
  { name:"Voice Journal",      icon:"auto_stories",       desc:"Free-form daily reflection with date context.",       tag:"Personal"     },
  { name:"Lecture Capture",    icon:"school",             desc:"Topic, key concepts, questions and summary.",         tag:"Academic"     },
  { name:"Interview Record",   icon:"record_voice_over",  desc:"Q&A format for structured interview transcription.",  tag:"Professional" },
  { name:"Creative Dictation", icon:"edit_note",          desc:"Open canvas for stories, scenes or brainstorms.",     tag:"Creative"     },
  { name:"To-do Dictation",    icon:"checklist",          desc:"Fast bullet-point task and reminder capture.",        tag:"Productivity" },
];

// ─────────────────────────────────────────────
// DOWNLOADER PANEL
// ─────────────────────────────────────────────
const BACKEND = "https://my-stt-app-production.up.railway.app";

const SUPPORTED_SITES = [
  { icon:"smart_display",   name:"YouTube"      },
  { icon:"alternate_email", name:"Twitter / X"  },
  { icon:"photo_camera",    name:"Instagram"    },
  { icon:"music_video",     name:"TikTok"       },
  { icon:"live_tv",         name:"Facebook"     },
  { icon:"podcasts",        name:"SoundCloud"   },
];

function DownloaderPanel({ dark }) {
  const [url,          setUrl]          = useState("");
  const [formats,      setFormats]      = useState([]);
  const [videoInfo,    setVideoInfo]    = useState(null);
  const [selectedFmt,  setSelectedFmt]  = useState("");
  const [status,       setStatus]       = useState("idle");
  const [errorMsg,     setErrorMsg]     = useState("");
  const [serverOnline, setServerOnline] = useState(null);

  // Health-check on mount
  useEffect(() => {
    fetch(`${BACKEND}/ping`)
      .then(r => setServerOnline(r.ok))
      .catch(() => setServerOnline(false));
  }, []);

  const reset = () => {
    setUrl("");
    setFormats([]);
    setVideoInfo(null);
    setSelectedFmt("");
    setStatus("idle");
    setErrorMsg("");
  };

  const fetchFormats = async () => {
    if (!url.trim()) return;
    setStatus("fetching");
    setFormats([]);
    setVideoInfo(null);
    setSelectedFmt("");
    setErrorMsg("");

    try {
      const res = await fetch(`${BACKEND}/formats?url=${encodeURIComponent(url.trim())}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      setVideoInfo({ title: data.title, thumbnail: data.thumbnail, duration: data.duration });
      setFormats(data.formats || []);
      if (data.formats && data.formats.length) setSelectedFmt(data.formats[0].id);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not reach server.");
    }
  };

  const startDownload = () => {
    if (!selectedFmt || !url || !videoInfo) return;
    setStatus("downloading");

    const dlUrl =
      `${BACKEND}/download` +
      `?url=${encodeURIComponent(url.trim())}` +
      `&formatId=${encodeURIComponent(selectedFmt)}` +
      `&title=${encodeURIComponent(videoInfo.title || "download")}`;

    // Hidden anchor — triggers file-save dialog, does NOT navigate the tab
    const a = document.createElement("a");
    a.href = dlUrl;
    a.setAttribute("download", "");
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setStatus("ready"), 8000);
  };

  // Theme tokens
  const pri     = "#59de9b";
  const priD    = "#003921";
  const bgLow   = dark ? "#1b1c1a" : "#ffffff";
  const bgMid   = dark ? "#1f201e" : "#f2f2f0";
  const bgHigh  = dark ? "#292a28" : "#e8e8e6";
  const ol      = dark ? "rgba(61,74,65,0.3)"  : "rgba(0,0,0,0.1)";
  const onBg    = dark ? "#e4e2df" : "#2c2c2a";
  const onMuted = dark ? "#bccabe" : "#555550";
  const onFaint = dark ? "#869489" : "#999994";

  const inputStyle = {
    flex:1, border:`1px solid ${ol}`, borderRadius:10,
    background:bgMid, color:onBg,
    fontFamily:"'Manrope',sans-serif", fontSize:14, fontWeight:500,
    padding:"12px 16px", outline:"none",
  };

  const btnPrimary = (disabled) => ({
    padding:"12px 22px", borderRadius:10, border:"none",
    cursor: disabled ? "not-allowed" : "pointer",
    background: disabled ? bgHigh : pri,
    color: disabled ? onFaint : priD,
    fontFamily:"'Manrope',sans-serif", fontSize:14, fontWeight:700,
    opacity: disabled ? 0.5 : 1, whiteSpace:"nowrap",
    display:"flex", alignItems:"center", gap:8,
    transition:"opacity .15s",
  });

  const videoFormats = formats.filter(f => !f.isAudio);
  const audioFormats = formats.filter(f =>  f.isAudio);

  const FormatGroup = ({ label, items }) => {
    if (!items.length) return null;
    return (
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:onFaint,textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:8,paddingLeft:2}}>{label}</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {items.map(f => {
            const sel = selectedFmt === f.id;
            return (
              <button key={f.id} onClick={() => setSelectedFmt(f.id)} style={{
                padding:"8px 14px", borderRadius:8,
                border:`1px solid ${sel ? pri : ol}`,
                background: sel ? "rgba(89,222,155,0.12)" : bgMid,
                color: sel ? pri : onMuted,
                fontFamily:"'Manrope',sans-serif", fontSize:13, fontWeight:600,
                cursor:"pointer", transition:"all .15s",
                display:"flex", alignItems:"center", gap:6,
              }}>
                <span className="mat" style={{fontSize:15}}>{f.isAudio ? "music_note" : "hd"}</span>
                {f.label}
                {f.filesize && (
                  <span style={{fontSize:11,color:onFaint,fontWeight:400}}>
                    · {(f.filesize/1024/1024).toFixed(0)}MB
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{maxWidth:760,margin:"0 auto"}}>

      {/* Header */}
      <div style={{marginBottom:28}}>
        <div style={{fontSize:22,fontWeight:800,letterSpacing:"-.03em",color:onBg,marginBottom:6}}>
          Media Downloader
        </div>
        <div style={{fontSize:13,color:onFaint,lineHeight:1.65}}>
          Paste any video URL, pick a quality, and download it straight to your device.
        </div>
      </div>

      {/* Server status */}
      {serverOnline === false && (
        <div style={{
          marginBottom:18,padding:"14px 18px",borderRadius:12,
          background:"rgba(255,100,80,0.06)",border:"1px solid rgba(255,100,80,0.2)",
          display:"flex",alignItems:"flex-start",gap:12,
        }}>
          <span className="mat" style={{color:"#ffb4ab",fontSize:20,flexShrink:0,marginTop:1}}>warning</span>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#ffb4ab",marginBottom:3}}>
              Backend not detected
            </div>
            <div style={{fontSize:12,color:dark?"#c07070":"#a04040",lineHeight:1.6}}>
              The Railway backend is offline. Check Railway deployment logs.
            </div>
          </div>
        </div>
      )}
      {serverOnline === true && (
        <div style={{
          marginBottom:18,padding:"9px 16px",borderRadius:10,
          background:"rgba(89,222,155,0.06)",border:"1px solid rgba(89,222,155,0.15)",
          display:"flex",alignItems:"center",gap:10,
        }}>
          <span style={{
            width:8,height:8,borderRadius:"50%",background:pri,flexShrink:0,display:"inline-block",
            boxShadow:"0 0 0 3px rgba(89,222,155,0.2)",
          }}/>
          <span style={{fontSize:12,fontWeight:700,color:pri}}>Server online — ready to download</span>
        </div>
      )}

      {/* URL input card */}
      <div style={{background:bgLow,border:`1px solid ${ol}`,borderRadius:16,padding:20,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:onFaint,textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:10}}>Video URL</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <input
            style={inputStyle}
            placeholder="https://youtube.com/watch?v=… or any supported link"
            value={url}
            onChange={e => {
              setUrl(e.target.value);
              if (status !== "idle") { setStatus("idle"); setFormats([]); setVideoInfo(null); }
            }}
            onKeyDown={e => e.key === "Enter" && fetchFormats()}
          />
          <button
            onClick={fetchFormats}
            disabled={!url.trim() || status === "fetching"}
            style={btnPrimary(!url.trim() || status === "fetching")}
          >
            {status === "fetching"
              ? <><span className="mat" style={{fontSize:16,animation:"spin 1s linear infinite"}}>refresh</span>Fetching…</>
              : <><span className="mat" style={{fontSize:16}}>search</span>Fetch Formats</>
            }
          </button>
          {(formats.length > 0 || videoInfo) && (
            <button onClick={reset} style={{
              padding:"12px 16px",borderRadius:10,
              border:`1px solid ${ol}`,background:"transparent",
              color:onFaint,cursor:"pointer",
              fontFamily:"'Manrope',sans-serif",fontSize:13,fontWeight:600,
            }}>Clear</button>
          )}
        </div>

        {/* Supported sites chips */}
        {status === "idle" && !videoInfo && (
          <div style={{marginTop:14,display:"flex",flexWrap:"wrap",gap:7}}>
            {SUPPORTED_SITES.map(s => (
              <div key={s.name} style={{
                display:"flex",alignItems:"center",gap:5,padding:"4px 10px",
                borderRadius:20,background:bgMid,border:`1px solid ${ol}`,
              }}>
                <span className="mat" style={{fontSize:13,color:onFaint}}>{s.icon}</span>
                <span style={{fontSize:11,fontWeight:600,color:onFaint}}>{s.name}</span>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",padding:"4px 10px",
              borderRadius:20,background:bgMid,border:`1px solid ${ol}`}}>
              <span style={{fontSize:11,fontWeight:600,color:onFaint}}>+ 1000 more</span>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {status === "error" && (
        <div style={{
          padding:"14px 18px",borderRadius:12,marginBottom:14,
          background:"rgba(255,100,80,0.06)",border:"1px solid rgba(255,100,80,0.2)",
          display:"flex",alignItems:"center",gap:12,
        }}>
          <span className="mat" style={{color:"#ffb4ab",fontSize:20}}>error_outline</span>
          <span style={{fontSize:13,color:dark?"#ffb4ab":"#a04040"}}>{errorMsg}</span>
        </div>
      )}

      {/* Video info + format picker */}
      {videoInfo && (
        <div style={{background:bgLow,border:`1px solid ${ol}`,borderRadius:16,overflow:"hidden",marginBottom:14}}>

          {/* Thumbnail + title row */}
          <div style={{display:"flex",alignItems:"stretch"}}>
            {videoInfo.thumbnail && (
              <div style={{width:150,flexShrink:0,overflow:"hidden",position:"relative"}}>
                <img src={videoInfo.thumbnail} alt=""
                  style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                <div style={{
                  position:"absolute",inset:0,
                  background:`linear-gradient(to right, transparent 55%, ${bgLow})`,
                }}/>
              </div>
            )}
            <div style={{padding:"18px 20px",flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:onBg,lineHeight:1.4,marginBottom:8}}>
                {videoInfo.title || "Unknown title"}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                {videoInfo.duration && (
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span className="mat" style={{fontSize:14,color:onFaint}}>schedule</span>
                    <span style={{fontSize:12,color:onFaint,fontWeight:600}}>{videoInfo.duration}</span>
                  </div>
                )}
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <span className="mat" style={{fontSize:14,color:pri}}>check_circle</span>
                  <span style={{fontSize:12,color:pri,fontWeight:700}}>{formats.length} formats available</span>
                </div>
              </div>
            </div>
          </div>

          {/* Format picker */}
          <div style={{padding:"16px 20px",borderTop:`1px solid ${ol}`}}>
            <div style={{fontSize:12,fontWeight:700,color:onFaint,textTransform:"uppercase",
              letterSpacing:"0.08em",marginBottom:14}}>Choose Quality</div>
            <FormatGroup label="Video + Audio" items={videoFormats} />
            <FormatGroup label="Audio Only"    items={audioFormats} />
          </div>

          {/* Download action bar */}
          <div style={{
            padding:"14px 20px",borderTop:`1px solid ${ol}`,
            background:dark?"rgba(255,255,255,0.02)":bgMid,
            display:"flex",alignItems:"center",justifyContent:"space-between",
            flexWrap:"wrap",gap:10,
          }}>
            <div style={{fontSize:13,color:onFaint}}>
              {selectedFmt
                ? <span>Selected: <strong style={{color:onBg}}>{formats.find(f=>f.id===selectedFmt)?.label || selectedFmt}</strong></span>
                : "No format selected"}
            </div>
            <button
              onClick={startDownload}
              disabled={!selectedFmt || status === "downloading"}
              style={btnPrimary(!selectedFmt || status === "downloading")}
            >
              <span className="mat" style={{fontSize:18}}>
                {status === "downloading" ? "hourglass_top" : "download"}
              </span>
              {status === "downloading" ? "Starting…" : "Download"}
            </button>
          </div>
        </div>
      )}

      {/* How it works — idle empty state only */}
      {status === "idle" && !videoInfo && (
        <div style={{background:bgLow,border:`1px solid ${ol}`,borderRadius:16,padding:20}}>
          <div style={{fontSize:13,fontWeight:700,color:onBg,marginBottom:14}}>How it works</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {[
              { icon:"link",     text:"Paste any video URL from YouTube, Twitter, Instagram, TikTok and more" },
              { icon:"tune",     text:"Click Fetch Formats — choose from all available video and audio qualities" },
              { icon:"download", text:"Hit Download and the file saves straight to your device"                 },
            ].map((s,i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:14}}>
                <div style={{
                  width:34,height:34,borderRadius:8,flexShrink:0,
                  background:"rgba(89,222,155,0.1)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                }}>
                  <span className="mat" style={{fontSize:18,color:pri}}>{s.icon}</span>
                </div>
                <span style={{fontSize:13,color:onMuted,lineHeight:1.5}}>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Default settings
// ─────────────────────────────────────────────
const DEFAULT_SETTINGS = { dark:true, fontSize:20, autoSave:true, sounds:true, lang:"en-US" };

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
export default function App() {
  const [transcript,   setTranscript]   = useState("");
  const [activeNav,    setActiveNav]    = useState("studio");
  const [history,      setHistory]      = useState(() => LS.get("va_history", []));
  const [pinned,       setPinned]       = useState(() => LS.get("va_pinned",  []));
  const [notification, setNotification] = useState(null);
  const [showHelp,     setShowHelp]     = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [settings,     setSettings]     = useState(() => LS.get("va_settings", DEFAULT_SETTINGS));

  const dark = settings.dark;

  useEffect(() => { LS.set("va_settings", settings); }, [settings]);

  const changeSetting = useCallback((k, v) => setSettings(p => ({ ...p, [k]: v })), []);

  const notifyRef = useRef(null);
  const notify    = useCallback((msg) => {
    setNotification(msg);
    clearTimeout(notifyRef.current);
    notifyRef.current = setTimeout(() => setNotification(null), 2500);
  }, []);

  const transcriptRef   = useRef("");
  const startTimeRef    = useRef(null);
  const sessionTitleRef = useRef("");

  useEffect(() => { transcriptRef.current   = transcript;   }, [transcript]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);

  const handleTranscript = useCallback((text) => setTranscript(text), []);

  const handleStart = useCallback(() => {
    startTimeRef.current = Date.now();
  }, []);

  const handleStop = useCallback(() => {
    const text = transcriptRef.current.trim();
    if (!settings.autoSave || !text) return;
    const dur   = startTimeRef.current
      ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
    const entry = {
      id:       Date.now(),
      title:    sessionTitleRef.current || "Untitled Session",
      text,
      date:     new Date().toLocaleString("en-GB", {
                  day:"2-digit", month:"short", year:"numeric",
                  hour:"2-digit", minute:"2-digit",
                }),
      words:    text.split(/\s+/).filter(Boolean).length,
      duration: formatDuration(dur),
    };
    setHistory(prev => {
      const updated = [entry, ...prev.slice(0, 49)];
      LS.set("va_history", updated);
      return updated;
    });
    notify("Session saved to Recent Dictations");
    setSessionTitle("");
    startTimeRef.current = null;
  }, [settings.autoSave, notify]);

  const handlePin = useCallback((entry) => {
    setPinned(prev => {
      const exists  = prev.find(p => p.id === entry.id);
      const updated = exists ? prev.filter(p => p.id !== entry.id) : [entry, ...prev];
      LS.set("va_pinned", updated);
      notify(exists ? "Unpinned" : "Pinned to library");
      return updated;
    });
  }, [notify]);

  const isPinned = (id) => pinned.some(p => p.id === id);

  const deleteHistory = (id) => {
    setHistory(prev => { const u = prev.filter(h => h.id !== id); LS.set("va_history", u); return u; });
  };

  const handleClearHistory = () => {
    if (!window.confirm("Clear all recent dictations?")) return;
    setHistory([]); LS.remove("va_history"); setShowSettings(false); notify("History cleared");
  };

  const handleClearAll = () => {
    if (!window.confirm("Reset everything? This clears all transcripts, history and pinned items.")) return;
    setHistory([]); setPinned([]); setTranscript("");
    LS.remove("va_history"); LS.remove("va_pinned"); LS.remove("stt_transcript");
    setShowSettings(false); notify("Everything cleared");
  };

  const navItems = [
    { id:"studio",     icon:"mic",          label:"Studio"             },
    { id:"recent",     icon:"history",      label:"Recent Dictations"  },
    { id:"pinned",     icon:"push_pin",     label:"Pinned Transcripts" },
    { id:"templates",  icon:"auto_stories", label:"Templates"          },
    { id:"downloader", icon:"download",     label:"Downloader"         },
  ];

  // Theme tokens
  const bg      = dark ? "#131412" : "#f8f8f6";
  const bgLow   = dark ? "#1b1c1a" : "#ffffff";
  const bgMid   = dark ? "#1f201e" : "#f2f2f0";
  const bgHigh  = dark ? "#292a28" : "#e8e8e6";
  const bgTop   = dark ? "#343533" : "#d0d0ce";
  const onBg    = dark ? "#e4e2df" : "#1a1a18";
  const onMuted = dark ? "#bccabe" : "#555550";
  const onFaint = dark ? "#869489" : "#999994";
  const ol      = dark ? "rgba(61,74,65,0.3)"  : "rgba(0,0,0,0.1)";
  const pri     = "#59de9b";
  const priD    = "#003921";
  const err     = dark ? "#ffb4ab" : "#c0392b";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; font-family: 'Manrope', sans-serif; background: ${bg}; color: ${onBg}; transition: background .25s, color .25s; }
        .mat { font-family: 'Material Symbols Outlined'; font-weight: 400; font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24; font-style: normal; user-select: none; display: inline-block; line-height: 1; }
        .mat-fill { font-variation-settings: 'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${ol}; border-radius: 4px; }

        .va-shell { display: flex; flex-direction: column; min-height: 100%; }
        .va-body  { display: flex; flex: 1; padding-top: 64px; min-height: calc(100vh - 64px); }
        .va-main  { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

        .va-top {
          position: fixed; top: 0; left: 0; right: 0; height: 64px; z-index: 100;
          background: ${dark ? "rgba(10,10,9,0.82)" : "rgba(248,248,246,0.9)"};
          backdrop-filter: blur(20px); border-bottom: 1px solid ${ol};
          display: flex; align-items: center; justify-content: space-between; padding: 0 28px;
        }
        .va-logo { font-size: 17px; font-weight: 800; letter-spacing: -0.04em; color: ${pri}; cursor: pointer; white-space: nowrap; }
        .va-topnav { display: flex; gap: 20px; }
        .va-topnav a { font-size: 13px; font-weight: 600; color: ${onFaint}; text-decoration: none; padding-bottom: 2px; border-bottom: 2px solid transparent; transition: color .2s, border-color .2s; }
        .va-topnav a.active { color: ${pri}; border-bottom-color: ${pri}; }
        .va-topnav a:hover:not(.active) { color: ${onBg}; }
        .va-top-actions { display: flex; gap: 4px; }
        .va-icon-btn { width: 36px; height: 36px; border-radius: 8px; border: none; background: transparent; color: ${onFaint}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; }
        .va-icon-btn:hover { background: ${bgHigh}; color: ${onBg}; }

        .va-side {
          width: 256px; flex-shrink: 0;
          background: ${dark ? "rgba(10,10,9,0.5)" : bgLow};
          border-right: 1px solid ${ol};
          display: flex; flex-direction: column; padding: 22px 14px; overflow-y: auto;
        }
        .va-side-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; padding: 0 8px; }
        .va-side-avatar { width: 36px; height: 36px; border-radius: 8px; background: ${bgHigh}; overflow: hidden; flex-shrink: 0; }
        .va-side-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .va-brand-name { font-size: 14px; font-weight: 800; color: ${onBg}; letter-spacing: -0.03em; line-height: 1.1; }
        .va-brand-sub  { font-size: 11px; color: ${onFaint}; margin-top: 2px; }
        .va-new-btn {
          width: 100%; padding: 11px; margin-bottom: 14px;
          background: ${pri}; color: ${priD}; border: none; border-radius: 10px; cursor: pointer;
          font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: transform .15s, opacity .15s;
        }
        .va-new-btn:hover  { opacity: .9; }
        .va-new-btn:active { transform: scale(.97); }
        .va-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .va-nav-item {
          display: flex; align-items: center; gap: 12px; padding: 10px 14px;
          border-radius: 10px; border: none; background: transparent; color: ${onFaint};
          cursor: pointer; font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 600;
          text-align: left; width: 100%; transition: background .15s, color .15s, transform .15s;
        }
        .va-nav-item:hover  { background: ${bgHigh}; color: ${onBg}; transform: translateX(2px); }
        .va-nav-item.active { background: ${bgHigh}; color: ${pri}; }
        .va-nav-item .mat   { font-size: 20px; }
        .va-side-footer { padding-top: 12px; margin-top: 8px; border-top: 1px solid ${ol}; display: flex; flex-direction: column; gap: 2px; }

        .va-content { max-width: 840px; margin: 0 auto; padding: 44px 28px 48px; width: 100%; }
        .va-hero    { text-align: center; margin-bottom: 40px; }
        .va-hero h1 { font-size: clamp(34px,5vw,56px); font-weight: 800; letter-spacing: -0.04em; color: ${onBg}; line-height: 1.05; margin-bottom: 12px; }
        .va-hero p  { font-size: 14px; color: ${onMuted}; max-width: 440px; margin: 0 auto; line-height: 1.7; font-weight: 500; }

        .va-session-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 16px; background: ${bgMid}; border-radius: 10px; border: 1px solid ${ol}; }
        .va-session-input { flex: 1; border: none; background: transparent; font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 600; color: ${onBg}; outline: none; }
        .va-session-input::placeholder { color: ${onFaint}; }
        .va-session-tag { font-size: 11px; padding: 2px 8px; border-radius: 20px; background: rgba(89,222,155,0.1); color: ${pri}; font-weight: 700; white-space: nowrap; flex-shrink: 0; }

        .va-studio-card {
          background: ${bgLow}; border: 1px solid ${ol}; border-radius: 20px;
          overflow: hidden; margin-bottom: 32px; position: relative;
        }
        .va-studio-card::before {
          content: ''; position: absolute; top: -60px; right: -60px; width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(89,222,155,0.04) 0%, transparent 70%); pointer-events: none;
        }

        .va-stt .stt-wrap            { border: none !important; border-radius: 0 !important; background: transparent !important; }
        .va-stt .stt-topbar          { background: ${dark?"rgba(255,255,255,0.025)":bgMid} !important; border-bottom: 1px solid ${ol} !important; padding: 12px 22px !important; }
        .va-stt .stt-status          { color: ${onMuted} !important; }
        .va-stt .stt-timer           { color: ${pri} !important; }
        .va-stt .stt-engine-badge    { background: rgba(89,222,155,0.1) !important; color: ${pri} !important; }
        .va-stt .stt-meta            { color: ${onFaint} !important; }
        .va-stt .stt-toolbar         { background: ${dark?"rgba(255,255,255,0.02)":bgMid} !important; border-bottom: 1px solid ${ol} !important; padding: 6px 18px !important; }
        .va-stt .stt-tool-btn        { background: transparent !important; border-color: ${ol} !important; color: ${onFaint} !important; }
        .va-stt .stt-tool-btn:hover  { background: ${bgHigh} !important; color: ${onBg} !important; }
        .va-stt .stt-tool-btn--active{ background: ${pri} !important; color: ${priD} !important; border-color: ${pri} !important; }
        .va-stt .stt-tool-label      { color: ${onFaint} !important; }
        .va-stt .stt-search-bar      { background: ${dark?"rgba(255,255,255,0.02)":bgMid} !important; border-bottom: 1px solid ${ol} !important; }
        .va-stt .stt-search-input    { color: ${onBg} !important; }
        .va-stt .stt-search-input::placeholder { color: ${onFaint} !important; }
        .va-stt .stt-display {
          background: transparent !important; padding: 28px !important;
          min-height: 210px !important; max-height: 440px !important;
          color: ${onBg} !important; font-size: ${settings.fontSize}px !important;
          font-weight: 300 !important; line-height: 1.85 !important; letter-spacing: -.01em !important;
        }
        .va-stt .stt-final           { color: ${dark?"#d8d6d3":onBg} !important; }
        .va-stt .stt-interim         { color: rgba(89,222,155,${dark?".4":".65"}) !important; font-style: normal !important; }
        .va-stt .stt-placeholder     { color: ${bgTop} !important; font-size: ${settings.fontSize}px !important; }
        .va-stt .stt-controls        { background: ${dark?"rgba(255,255,255,0.02)":bgMid} !important; border-top: 1px solid ${ol} !important; padding: 14px 22px !important; }
        .va-stt .stt-btn--primary    { background: ${pri} !important; color: ${priD} !important; border-color: ${pri} !important; font-weight: 700 !important; }
        .va-stt .stt-btn--danger     { background: transparent !important; color: ${err} !important; border-color: ${dark?"rgba(255,180,171,0.25)":"rgba(192,57,43,0.3)"} !important; }
        .va-stt .stt-btn--danger:hover:not(:disabled) { background: ${dark?"rgba(255,180,171,0.06)":"rgba(192,57,43,0.06)"} !important; }
        .va-stt .stt-btn--amber      { background: transparent !important; color: #e8c87a !important; border-color: rgba(232,200,122,0.3) !important; }
        .va-stt .stt-btn--amber:hover:not(:disabled) { background: rgba(232,200,122,0.07) !important; }
        .va-stt .stt-btn--ghost      { background: transparent !important; color: ${onFaint} !important; border-color: ${ol} !important; }
        .va-stt .stt-btn--ghost:hover:not(:disabled) { background: ${bgHigh} !important; color: ${onBg} !important; }
        .va-stt .stt-btn--destructive{ color: ${err} !important; }
        .va-stt .stt-hint            { background: transparent !important; color: ${onFaint} !important; padding: 8px 22px 14px !important; }
        .va-stt .stt-hint kbd        { background: ${bgHigh} !important; color: ${onMuted} !important; border-color: ${ol} !important; }
        .va-stt .stt-loading-screen  { background: transparent !important; padding: 52px 24px !important; }
        .va-stt .stt-loading-title   { color: ${onBg} !important; }
        .va-stt .stt-loading-detail  { color: ${onFaint} !important; }
        .va-stt .stt-loading-bar-track { background: ${bgHigh} !important; }
        .va-stt .stt-loading-bar-fill  { background: linear-gradient(90deg,#00a86b,#59de9b) !important; }
        .va-stt .stt-loading-pct       { color: ${onFaint} !important; }
        .va-stt .stt-loading-tip       { background: ${dark?"rgba(255,255,255,0.02)":bgMid} !important; border-color: ${ol} !important; color: ${onMuted} !important; }
        .va-stt .stt-loading-tip-label { color: ${pri} !important; }
        .va-stt .stt-loading-suggestion{ background: rgba(89,222,155,0.06) !important; color: ${pri} !important; border: 1px solid rgba(89,222,155,0.15) !important; border-radius: 8px !important; }
        .va-stt .stt-loading-icon      { color: ${pri} !important; }
        .va-stt .stt-mobile-banner     { background: rgba(232,200,122,0.08) !important; color: #e8c87a !important; border-bottom-color: rgba(232,200,122,0.2) !important; }
        .va-stt .stt-progress-track    { background: ${bgHigh} !important; }
        .va-stt .stt-progress-fill     { background: ${pri} !important; }

        .va-features { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 40px; }
        @media(max-width:640px) { .va-features { grid-template-columns: 1fr; } }
        .va-feat { padding: 20px; background: ${bgMid}; border: 1px solid ${ol}; border-radius: 14px; display: flex; align-items: flex-start; gap: 14px; transition: transform .2s; }
        .va-feat:hover { transform: translateY(-2px); }
        .va-feat-icon { width: 40px; height: 40px; border-radius: 9px; background: rgba(89,222,155,0.1); color: ${pri}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .va-feat-icon .mat { font-size: 20px; }
        .va-feat h3 { font-size: 13px; font-weight: 700; color: ${onBg}; margin-bottom: 4px; }
        .va-feat p  { font-size: 12px; color: ${onFaint}; line-height: 1.55; }

        .va-panel-title { font-size: 22px; font-weight: 800; letter-spacing: -.03em; color: ${onBg}; margin-bottom: 6px; }
        .va-panel-sub   { font-size: 13px; color: ${onFaint}; margin-bottom: 22px; line-height: 1.65; }

        .va-entry { background: ${bgLow}; border: 1px solid ${ol}; border-radius: 14px; padding: 18px 20px; margin-bottom: 10px; transition: border-color .2s, transform .15s; }
        .va-entry:hover { border-color: rgba(89,222,155,0.22); transform: translateX(2px); }
        .va-entry-top    { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .va-entry-title  { font-size: 14px; font-weight: 700; color: ${onBg}; margin-bottom: 4px; }
        .va-entry-meta   { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .va-entry-date   { font-size: 11px; color: ${onFaint}; font-weight: 600; }
        .va-entry-badge  { font-size: 11px; color: ${pri}; font-weight: 700; background: rgba(89,222,155,0.1); padding: 2px 7px; border-radius: 20px; }
        .va-entry-text   { font-size: 13px; color: ${onMuted}; line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .va-entry-actions{ display: flex; gap: 4px; flex-shrink: 0; }
        .va-entry-btn    { width: 30px; height: 30px; border-radius: 7px; border: none; background: transparent; color: ${onFaint}; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; }
        .va-entry-btn:hover { background: ${bgHigh}; color: ${onBg}; }
        .va-entry-btn.pinned { color: ${pri}; }
        .va-entry-btn .mat   { font-size: 18px; }

        .va-empty { text-align: center; padding: 56px 24px; color: ${onFaint}; font-size: 14px; line-height: 1.8; }
        .va-empty .mat { font-size: 44px; display: block; margin-bottom: 12px; color: ${bgTop}; }

        .va-tmpl-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
        @media(max-width:600px) { .va-tmpl-grid { grid-template-columns: 1fr; } }
        .va-tmpl { padding: 20px; background: ${bgLow}; border: 1px solid ${ol}; border-radius: 14px; cursor: pointer; transition: border-color .2s, transform .15s; }
        .va-tmpl:hover { border-color: rgba(89,222,155,0.28); transform: translateY(-1px); }
        .va-tmpl-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .va-tmpl-icon { width: 34px; height: 34px; border-radius: 8px; background: rgba(89,222,155,0.1); color: ${pri}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .va-tmpl-name { font-size: 14px; font-weight: 700; color: ${onBg}; }
        .va-tmpl-desc { font-size: 12px; color: ${onFaint}; line-height: 1.55; margin-bottom: 10px; }
        .va-tmpl-tag  { font-size: 11px; padding: 2px 8px; border-radius: 20px; background: rgba(89,222,155,0.08); color: ${pri}; font-weight: 700; }

        .va-footer {
          border-top: 1px solid ${ol}; background: ${bgLow};
          padding: 18px 28px; display: flex; justify-content: space-between;
          align-items: center; flex-wrap: wrap; gap: 10px; margin-top: auto;
        }
        .va-footer span { font-size: 12px; color: ${onFaint}; }
        .va-footer-links { display: flex; gap: 20px; }
        .va-footer-links a { font-size: 12px; color: ${onFaint}; text-decoration: none; transition: color .2s; }
        .va-footer-links a:hover { color: ${pri}; }

        .va-toast {
          position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
          background: ${bgTop}; color: ${onBg}; padding: 9px 20px; border-radius: 999px;
          font-size: 13px; font-weight: 600; z-index: 300; border: 1px solid ${ol};
          animation: toast-in .2s ease; white-space: nowrap; pointer-events: none;
        }
        @keyframes toast-in { from { opacity:0; transform: translateX(-50%) translateY(6px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }

        .va-mobile-nav {
          display: none; position: fixed; bottom: 0; left: 0; right: 0; height: 58px;
          background: ${dark?"rgba(10,10,9,0.92)":bgLow}; backdrop-filter: blur(20px);
          border-top: 1px solid ${ol}; justify-content: space-around; align-items: center; z-index: 50;
        }
        .va-mobile-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; border: none; background: transparent; color: ${onFaint}; cursor: pointer; font-family: 'Manrope',sans-serif; font-size: 10px; font-weight: 700; transition: color .15s; }
        .va-mobile-btn.active { color: ${pri}; }
        .va-mobile-btn .mat   { font-size: 22px; }

        @media(max-width:1023px) {
          .va-side       { display: none; }
          .va-topnav     { display: none; }
          .va-mobile-nav { display: flex; }
          .va-content    { padding-bottom: 80px; }
        }
      `}</style>

      <div className="va-shell">

        {/* ── topbar ── */}
        <header className="va-top">
          <div className="va-logo" onClick={() => setActiveNav("studio")}>
            The Speech Studio
          </div>
          <nav className="va-topnav">
            {navItems.map(n => (
              <a key={n.id} href="#"
                className={activeNav === n.id ? "active" : ""}
                onClick={e => { e.preventDefault(); setActiveNav(n.id); }}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="va-top-actions">
            <button className="va-icon-btn"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => changeSetting("dark", !dark)}>
              <span className="mat">{dark ? "light_mode" : "dark_mode"}</span>
            </button>
            <button className="va-icon-btn" title="Help" onClick={() => setShowHelp(true)}>
              <span className="mat">help_outline</span>
            </button>
            <button className="va-icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
              <span className="mat">settings</span>
            </button>
          </div>
        </header>

        <div className="va-body">

          {/* ── sidebar ── */}
          <aside className="va-side">
            <div className="va-side-brand">
              <div className="va-side-avatar">
                <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuB62WlH38enWgoNF0znau-7_lQVRl2SPcvrThs5kWgqoHH8KuFuDAM1aBbVIyAI2ygTRPWKuLEC6TdKLRO69c1ACQFesHLHCoVr8xs3wZ15R8bNJWkPQ7cAOGHj0vQzFtZy8uXdQx-5eSEqsMMNaXd8fkJqxmGxsMcrC-9hstfDbPPwxFxGmfQ2yGzkaFiP0zkM8CQguZOlMETQQa5E0YUSCO7DCo3n__gj8eFiNq-IYSD7UYWaeBeEr4E6AL4a8S56t_dw9AMsswh-" alt="studio"/>
              </div>
              <div>
                <div className="va-brand-name">The Speech Studio</div>
                <div className="va-brand-sub">Deep Work Mode</div>
              </div>
            </div>

            <button className="va-new-btn"
              onClick={() => { setActiveNav("studio"); setSessionTitle(""); }}>
              <span className="mat">add</span> New Session
            </button>

            <nav className="va-nav">
              {navItems.map(n => (
                <button key={n.id}
                  className={`va-nav-item${activeNav === n.id ? " active" : ""}`}
                  onClick={() => setActiveNav(n.id)}>
                  <span className="mat">{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </nav>

            <footer className="va-side-footer">
              <button className="va-nav-item" onClick={() => setShowHelp(true)}>
                <span className="mat">help_outline</span> Help Centre
              </button>
              <button className="va-nav-item" onClick={() => setShowSettings(true)}>
                <span className="mat">settings</span> Settings
              </button>
              <button className="va-nav-item" onClick={() => changeSetting("dark", !dark)}>
                <span className="mat">{dark ? "light_mode" : "dark_mode"}</span>
                {dark ? "Light Mode" : "Dark Mode"}
              </button>
            </footer>
          </aside>

          {/* ── main ── */}
          <main className="va-main">
            <div style={{ flex: 1 }}>

              {/* STUDIO */}
              {activeNav === "studio" && (
                <div className="va-content">
                  <div className="va-hero">
                    <h1>The Studio</h1>
                    <p>Capture your thoughts with precision. Your voice translated into refined text in real time.</p>
                  </div>

                  <div className="va-session-bar">
                    <span className="mat" style={{ color: pri, fontSize: 18 }}>label</span>
                    <input
                      className="va-session-input"
                      placeholder="Name this session (optional)…"
                      value={sessionTitle}
                      onChange={e => setSessionTitle(e.target.value)}
                    />
                    {sessionTitle && <span className="va-session-tag">{sessionTitle}</span>}
                  </div>

                  <div className="va-studio-card">
                    <div className="va-stt" style={{ position: "relative" }}>
                      <StopInterceptor onStart={handleStart} onStop={handleStop}/>
                      <SpeechInput
                        onTranscript={handleTranscript}
                        placeholder={sessionTitle
                          ? `${sessionTitle} — begin speaking…`
                          : "Your words will appear here as you speak…"}
                      />
                    </div>
                  </div>

                  <div className="va-features">
                    {[
                      { icon:"auto_fix_high", title:"Smart Formatting",  desc:"Auto-punctuation for editorial clarity."     },
                      { icon:"lock",          title:"Private & Local",   desc:"Nothing leaves your browser. Ever."          },
                      { icon:"history",       title:"Auto-saved",        desc:"Sessions saved to Recent on Stop."           },
                      { icon:"download",      title:"Export",            desc:"Download as .txt in one click."              },
                      { icon:"search",        title:"Search",            desc:"Find any word in your transcript."           },
                      { icon:"text_fields",   title:"Font Controls",     desc:"Adjust transcript size for comfort."         },
                    ].map(f => (
                      <div key={f.title} className="va-feat">
                        <div className="va-feat-icon"><span className="mat">{f.icon}</span></div>
                        <div><h3>{f.title}</h3><p>{f.desc}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RECENT */}
              {activeNav === "recent" && (
                <div className="va-content">
                  <div className="va-panel-title">Recent Dictations</div>
                  <div className="va-panel-sub">
                    Sessions save automatically when you click <strong style={{ color: onBg }}>Stop</strong>.<br/>
                    Click the <span className="mat" style={{ fontSize: 14, verticalAlign: "middle" }}>push_pin</span> icon on any entry to pin it permanently.
                  </div>
                  {history.length === 0 ? (
                    <div className="va-empty">
                      <span className="mat">history</span>
                      No sessions yet.<br/>Go to Studio, record something and click Stop.
                    </div>
                  ) : history.map(entry => (
                    <div key={entry.id} className="va-entry">
                      <div className="va-entry-top">
                        <div>
                          <div className="va-entry-title">{entry.title || "Untitled Session"}</div>
                          <div className="va-entry-meta">
                            <span className="va-entry-date">{entry.date}</span>
                            <span className="va-entry-badge">{entry.words} words</span>
                            {entry.duration && <span className="va-entry-badge">{entry.duration}</span>}
                          </div>
                        </div>
                        <div className="va-entry-actions">
                          <button
                            className={`va-entry-btn${isPinned(entry.id) ? " pinned" : ""}`}
                            title={isPinned(entry.id) ? "Unpin from library" : "Pin to library"}
                            onClick={() => handlePin(entry)}>
                            <span className={`mat${isPinned(entry.id) ? " mat-fill" : ""}`}>push_pin</span>
                          </button>
                          <button className="va-entry-btn" title="Copy"
                            onClick={() => { navigator.clipboard.writeText(entry.text); notify("Copied!"); }}>
                            <span className="mat">content_copy</span>
                          </button>
                          <button className="va-entry-btn" title="Delete"
                            onClick={() => deleteHistory(entry.id)}>
                            <span className="mat">delete</span>
                          </button>
                        </div>
                      </div>
                      <div className="va-entry-text">{entry.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* PINNED */}
              {activeNav === "pinned" && (
                <div className="va-content">
                  <div className="va-panel-title">Pinned Transcripts</div>
                  <div className="va-panel-sub">
                    Permanently saved sessions for quick access.<br/>
                    To pin: go to Recent Dictations and click the <span className="mat" style={{ fontSize: 14, verticalAlign: "middle" }}>push_pin</span> icon.
                  </div>
                  {pinned.length === 0 ? (
                    <div className="va-empty">
                      <span className="mat">push_pin</span>
                      Nothing pinned yet.<br/>Go to Recent Dictations and pin a session.
                    </div>
                  ) : pinned.map(entry => (
                    <div key={entry.id} className="va-entry">
                      <div className="va-entry-top">
                        <div>
                          <div className="va-entry-title">{entry.title || "Untitled Session"}</div>
                          <div className="va-entry-meta">
                            <span className="va-entry-date">{entry.date}</span>
                            <span className="va-entry-badge">{entry.words} words</span>
                            {entry.duration && <span className="va-entry-badge">{entry.duration}</span>}
                          </div>
                        </div>
                        <div className="va-entry-actions">
                          <button className="va-entry-btn pinned" title="Unpin"
                            onClick={() => handlePin(entry)}>
                            <span className="mat mat-fill">push_pin</span>
                          </button>
                          <button className="va-entry-btn" title="Copy"
                            onClick={() => { navigator.clipboard.writeText(entry.text); notify("Copied!"); }}>
                            <span className="mat">content_copy</span>
                          </button>
                        </div>
                      </div>
                      <div className="va-entry-text">{entry.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* TEMPLATES */}
              {activeNav === "templates" && (
                <div className="va-content">
                  <div className="va-panel-title">Templates</div>
                  <div className="va-panel-sub">
                    Choose a template to pre-name your session and jump straight into recording.<br/>
                    Clicking a template takes you to the Studio with the session title already set.
                  </div>
                  <div className="va-tmpl-grid">
                    {TEMPLATES.map(t => (
                      <div key={t.name} className="va-tmpl"
                        onClick={() => {
                          setSessionTitle(t.name);
                          setActiveNav("studio");
                          notify(`Template: ${t.name}`);
                        }}>
                        <div className="va-tmpl-head">
                          <div className="va-tmpl-icon"><span className="mat">{t.icon}</span></div>
                          <div className="va-tmpl-name">{t.name}</div>
                        </div>
                        <div className="va-tmpl-desc">{t.desc}</div>
                        <span className="va-tmpl-tag">{t.tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DOWNLOADER */}
              {activeNav === "downloader" && (
                <div className="va-content">
                  <DownloaderPanel dark={dark} />
                </div>
              )}

            </div>

            <footer className="va-footer">
              <span>© 2024 The Speech Studio. All rights reserved.</span>
              <div className="va-footer-links">
                <a href="#" onClick={e => { e.preventDefault(); setShowHelp(true); }}>Help</a>
                <a href="#" onClick={e => { e.preventDefault(); setShowSettings(true); }}>Settings</a>
                <a href="#">Privacy Policy</a>
              </div>
            </footer>
          </main>
        </div>

        {/* mobile nav */}
        <nav className="va-mobile-nav">
          {navItems.map(n => (
            <button key={n.id}
              className={`va-mobile-btn${activeNav === n.id ? " active" : ""}`}
              onClick={() => setActiveNav(n.id)}>
              <span className="mat">{n.icon}</span>
              {n.label.split(" ")[0]}
            </button>
          ))}
        </nav>

      </div>

      <HelpModal    open={showHelp}     onClose={() => setShowHelp(false)}     dark={dark} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} dark={dark}
        settings={settings} onChange={changeSetting}
        onClearHistory={handleClearHistory} onClearAll={handleClearAll} />

      {notification && <div className="va-toast">{notification}</div>}
    </>
  );
}
