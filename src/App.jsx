import React, { useState, useEffect, useRef, useCallback } from "react";
import SpeechInput from "./components/SpeechInput";

const LS = {
  get: (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  remove: (k) => { try { localStorage.removeItem(k); } catch {} },
};

function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

const FAQ = [
  { q:"How does speech recognition work?", a:"On Chrome, Edge and Safari your browser's built-in speech engine is used. On Firefox a local AI model downloads once to your device." },
  { q:"Is my audio sent to any server?", a:"On Chrome/Edge/Safari audio is processed by their respective servers. On Firefox it runs entirely locally." },
  { q:"How does the media downloader work?", a:"Paste any video URL, fetch available qualities, and download the file directly to your device via our Railway backend." },
];

function HelpModal({ open, onClose, dark }) {
  const [idx, setIdx] = useState(null);
  const c = { border:`1px solid ${dark?"rgba(61,74,65,0.25)":"#f0f0ee"}`,paddingBottom:12,marginBottom:12 };
  return (
    <Modal open={open} onClose={onClose} title="Help Centre" dark={dark}>
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
          {idx===i && <p style={{fontSize:13,color:dark?"#bccabe":"#666",marginTop:8}}>{item.a}</p>}
        </div>
      ))}
    </Modal>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width:46,height:25,borderRadius:999,border:"none",cursor:"pointer",position:"relative",
      background: checked ? "#59de9b" : "#444441", transition:"background .2s",
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
    padding:"7px 14px",borderRadius:8, border:`1px solid ${dark?"rgba(255,100,80,0.3)":"#ffa0a0"}`,
    background:"transparent",cursor:"pointer", fontFamily:"'Manrope',sans-serif",fontSize:12,fontWeight:600,
    color:dark?"#ffb4ab":"#c0392b",
  });
  return (
    <Modal open={open} onClose={onClose} title="Settings" dark={dark}>
      <SRow label="Dark mode" sub="Switch interface theme" dark={dark}>
        <Toggle checked={dark} onChange={v => onChange("dark", v)}/>
      </SRow>
      <SRow label="Auto-save sessions" sub="Save automatically on Stop" dark={dark}>
        <Toggle checked={settings.autoSave} onChange={v => onChange("autoSave", v)}/>
      </SRow>
      <div style={{marginTop:20,padding:16,borderRadius:10,background:dark?"rgba(255,100,80,0.04)":"#fff5f5",border:`1px solid ${dark?"rgba(255,100,80,0.15)":"#ffd5d5"}`}}>
        <div style={{fontSize:13,fontWeight:700,color:dark?"#ffb4ab":"#c0392b",marginBottom:12}}>Danger Zone</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button style={bs()} onClick={onClearHistory}>Clear history</button>
          <button style={bs()} onClick={onClearAll}>Reset everything</button>
        </div>
      </div>
    </Modal>
  );
}

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

// ── Downloader Module ──
const BACKEND = "https://my-stt-app-production.up.railway.app";

function DownloaderPanel({ dark }) {
  const [url, setUrl] = useState("");
  const [formats, setFormats] = useState([]);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedFmt, setSelectedFmt] = useState("");
  const [status, setStatus] = useState("idle"); 
  const [errorMsg, setErrorMsg] = useState("");
  const [serverOnline, setServerOnline] = useState(null);

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
    setErrorMsg("");

    try {
      const res = await fetch(`${BACKEND}/formats?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch formats");

      setVideoInfo({ title: data.title, thumbnail: data.thumbnail, duration: data.duration });
      setFormats(data.formats);
      if (data.formats.length) setSelectedFmt(data.formats[0].id);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Backend error.");
    }
  };

  const startDownload = () => {
    if (!selectedFmt || !url || !videoInfo) return;
    setStatus("downloading");

    const dlUrl = `${BACKEND}/download?url=${encodeURIComponent(url.trim())}&formatId=${encodeURIComponent(selectedFmt)}&title=${encodeURIComponent(videoInfo.title || "download")}`;
    
    // Hidden anchor trick to force download instead of navigating tab
    const a = document.createElement("a");
    a.href = dlUrl;
    a.setAttribute("download", ""); 
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setStatus("ready"), 5000);
  };

  const pri = "#59de9b";
  const bgLow = dark ? "#1b1c1a" : "#ffffff";
  const bgMid = dark ? "#1f201e" : "#f2f2f0";
  const ol = dark ? "rgba(61,74,65,0.3)" : "rgba(0,0,0,0.1)";
  const onBg = dark ? "#e4e2df" : "#2c2c2a";
  const onFaint = dark ? "#869489" : "#999994";

  return (
    <div style={{maxWidth:760,margin:"0 auto"}}>
      <div style={{marginBottom:28}}>
        <div style={{fontSize:22,fontWeight:800,color:onBg,marginBottom:6}}>Media Downloader</div>
        <div style={{fontSize:13,color:onFaint}}>Paste any video URL, pick a quality, and download.</div>
      </div>

      {serverOnline === false && (
        <div style={{padding:"14px",borderRadius:12,background:"rgba(255,100,80,0.06)",border:"1px solid rgba(255,100,80,0.2)",marginBottom:18,color:"#ffb4ab",fontSize:13}}>
          <strong>Backend offline:</strong> Cannot connect to Railway server.
        </div>
      )}
      {serverOnline === true && (
        <div style={{padding:"9px 16px",borderRadius:10,background:"rgba(89,222,155,0.06)",border:"1px solid rgba(89,222,155,0.15)",marginBottom:18,fontSize:12,color:pri,fontWeight:700}}>
          Server online — ready to download
        </div>
      )}

      <div style={{background:bgLow,border:`1px solid ${ol}`,borderRadius:16,padding:20,marginBottom:14}}>
        <div style={{display:"flex",gap:10}}>
          <input
            style={{flex:1, border:`1px solid ${ol}`, borderRadius:10, background:bgMid, color:onBg, padding:"12px 16px", outline:"none"}}
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchFormats()}
          />
          <button onClick={fetchFormats} disabled={!url || status==="fetching"} style={{padding:"12px 22px", borderRadius:10, border:"none", background:pri, color:"#003921", fontWeight:700, cursor:"pointer"}}>
            {status === "fetching" ? "Fetching..." : "Fetch"}
          </button>
          {(formats.length > 0 || videoInfo) && (
            <button onClick={reset} style={{padding:"12px 16px",borderRadius:10,border:`1px solid ${ol}`,background:"transparent",color:onFaint,cursor:"pointer"}}>Clear</button>
          )}
        </div>
      </div>

      {status === "error" && <div style={{padding:"14px",color:"#ffb4ab",fontSize:13,marginBottom:14}}>{errorMsg}</div>}

      {videoInfo && (
        <div style={{background:bgLow,border:`1px solid ${ol}`,borderRadius:16,padding:20}}>
          <h3 style={{color:onBg,marginBottom:14}}>{videoInfo.title}</h3>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
            {formats.map(f => (
              <button key={f.id} onClick={() => setSelectedFmt(f.id)} style={{
                padding:"8px 14px", borderRadius:8, cursor:"pointer",
                border:`1px solid ${selectedFmt === f.id ? pri : ol}`,
                background: selectedFmt === f.id ? "rgba(89,222,155,0.12)" : bgMid,
                color: selectedFmt === f.id ? pri : onFaint
              }}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={startDownload} disabled={!selectedFmt || status==="downloading"} style={{width:"100%",padding:"14px",borderRadius:10,border:"none",background:pri,color:"#003921",fontWeight:700,cursor:"pointer"}}>
            {status === "downloading" ? "Starting Download..." : "Download Selected File"}
          </button>
        </div>
      )}
    </div>
  );
}

const DEFAULT_SETTINGS = { dark:true, fontSize:20, autoSave:true, sounds:true, lang:"en-US" };

export default function App() {
  const [transcript, setTranscript] = useState("");
  const [activeNav, setActiveNav] = useState("studio");
  const [history, setHistory] = useState(() => LS.get("va_history", []));
  const [pinned, setPinned] = useState(() => LS.get("va_pinned", []));
  const [notification, setNotification] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("");
  const [settings, setSettings] = useState(() => LS.get("va_settings", DEFAULT_SETTINGS));

  const dark = settings.dark;
  useEffect(() => { LS.set("va_settings", settings); }, [settings]);

  const changeSetting = useCallback((k, v) => setSettings(p => ({ ...p, [k]: v })), []);

  const notifyRef = useRef(null);
  const notify = useCallback((msg) => {
    setNotification(msg);
    clearTimeout(notifyRef.current);
    notifyRef.current = setTimeout(() => setNotification(null), 2500);
  }, []);

  const transcriptRef = useRef("");
  const startTimeRef = useRef(null);
  const sessionTitleRef = useRef("");

  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);

  const handleStop = useCallback(() => {
    const text = transcriptRef.current.trim();
    if (!settings.autoSave || !text) return;
    const dur = startTimeRef.current ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
    const entry = {
      id: Date.now(),
      title: sessionTitleRef.current || "Untitled Session",
      text,
      date: new Date().toLocaleString(),
      words: text.split(/\s+/).filter(Boolean).length,
      duration: formatDuration(dur),
    };
    setHistory(prev => {
      const updated = [entry, ...prev.slice(0, 49)];
      LS.set("va_history", updated);
      return updated;
    });
    notify("Session saved");
    setSessionTitle("");
    startTimeRef.current = null;
  }, [settings.autoSave, notify]);

  const navItems = [
    { id:"studio", icon:"mic", label:"Studio" },
    { id:"recent", icon:"history", label:"Recent" },
    { id:"downloader", icon:"download", label:"Downloader" },
  ];

  const bg = dark ? "#131412" : "#f8f8f6";
  const bgLow = dark ? "#1b1c1a" : "#ffffff";
  const bgTop = dark ? "#343533" : "#d0d0ce";
  const onBg = dark ? "#e4e2df" : "#1a1a18";
  const onFaint = dark ? "#869489" : "#999994";
  const ol = dark ? "rgba(61,74,65,0.3)" : "rgba(0,0,0,0.1)";
  const pri = "#59de9b";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; font-family: 'Manrope', sans-serif; background: ${bg}; color: ${onBg}; }
        .mat { font-family: 'Material Symbols Outlined'; line-height: 1; user-select: none; }
        .va-shell { display: flex; flex-direction: column; min-height: 100%; }
        .va-top { height: 64px; background: ${bgTop}; display: flex; align-items: center; padding: 0 28px; justify-content: space-between; }
        .va-body { display: flex; flex: 1; }
        .va-side { width: 220px; border-right: 1px solid ${ol}; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
        .va-main { flex: 1; padding: 40px; overflow-y: auto; }
        .va-nav-item { background: transparent; border: none; color: ${onFaint}; padding: 10px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 10px; font-weight: 600; border-radius: 8px; }
        .va-nav-item.active { color: ${pri}; background: ${dark ? "#292a28" : "#e8e8e6"}; }
      `}</style>

      <div className="va-shell">
        <header className="va-top">
          <div style={{fontWeight:800, color:pri}}>The Speech Studio</div>
          <div>
            <button onClick={() => setShowSettings(true)} style={{background:"none",border:"none",color:onBg,cursor:"pointer",marginRight:15}}>Settings</button>
            <button onClick={() => setShowHelp(true)} style={{background:"none",border:"none",color:onBg,cursor:"pointer"}}>Help</button>
          </div>
        </header>

        <div className="va-body">
          <aside className="va-side">
            {navItems.map(n => (
              <button key={n.id} className={`va-nav-item ${activeNav === n.id ? "active" : ""}`} onClick={() => setActiveNav(n.id)}>
                <span className="mat">{n.icon}</span> {n.label}
              </button>
            ))}
          </aside>

          <main className="va-main">
            {activeNav === "studio" && (
              <div>
                <h1 style={{marginBottom:20}}>Studio</h1>
                <div style={{background:bgLow, border:`1px solid ${ol}`, borderRadius:16, padding:20}}>
                  <StopInterceptor onStart={() => startTimeRef.current = Date.now()} onStop={handleStop}/>
                  <SpeechInput onTranscript={text => setTranscript(text)} placeholder="Begin speaking..." />
                </div>
              </div>
            )}

            {activeNav === "recent" && (
              <div>
                <h1 style={{marginBottom:20}}>Recent</h1>
                {history.map(entry => (
                  <div key={entry.id} style={{background:bgLow, border:`1px solid ${ol}`, padding:15, borderRadius:12, marginBottom:10}}>
                    <div style={{fontWeight:700}}>{entry.title} <span style={{fontSize:12, color:onFaint}}>({entry.date})</span></div>
                    <div style={{fontSize:13, color:onFaint, marginTop:5}}>{entry.text}</div>
                  </div>
                ))}
              </div>
            )}

            {activeNav === "downloader" && <DownloaderPanel dark={dark} />}
          </main>
        </div>
      </div>

      <HelpModal open={showHelp} onClose={() => setShowHelp(false)} dark={dark} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} dark={dark} settings={settings} onChange={changeSetting} onClearHistory={() => setHistory([])} onClearAll={() => setHistory([])} />
      {notification && <div style={{position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)", background:pri, color:"#000", padding:"10px 20px", borderRadius:20}}>{notification}</div>}
    </>
  );
}