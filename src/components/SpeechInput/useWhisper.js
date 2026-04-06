import { useRef, useCallback, useState } from "react";

// how many seconds of audio per chunk sent to Whisper
const CHUNK_SECONDS = 5;
const SAMPLE_RATE   = 16000;
const CHUNK_SIZE    = CHUNK_SECONDS * SAMPLE_RATE; // 80,000 samples

export function useWhisper({ onResult, onStatusChange }) {
  const workerRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const procRef     = useRef(null);
  const streamRef   = useRef(null);

  // collect raw samples here until we have a full chunk
  const samplesRef  = useRef([]);
  const sampleCountRef = useRef(0);
  const fullTextRef = useRef("");
  const busyRef     = useRef(false); // prevent overlapping transcriptions

  const [ready,    setReady]    = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase,    setPhase]    = useState("idle");

  const load = useCallback(() => {
    if (workerRef.current) return;

    const w = new Worker("/whisper-worker.js");
    workerRef.current = w;

    w.onmessage = (e) => {
      const { type, progress: p, text } = e.data;

      if (type === "progress") {
        const val = Math.round(p ?? 0);
        setProgress(val);
        setPhase("downloading");
        onStatusChange?.({ phase: "downloading", progress: val });
      }
      if (type === "preparing") {
        setProgress(95);
        setPhase("preparing");
        onStatusChange?.({ phase: "preparing", progress: 95 });
      }
      if (type === "ready") {
        setProgress(100);
        setReady(true);
        setPhase("ready");
        onStatusChange?.({ phase: "ready", progress: 100 });
      }
      if (type === "result" && text?.trim()) {
        busyRef.current = false;
        // append this chunk's text to the full transcript
        const sep    = fullTextRef.current ? " " : "";
        const joined = fullTextRef.current + sep + text.trim();
        fullTextRef.current = joined;
        onResult({ final: joined, interim: "" });
      }
      if (type === "error") {
        busyRef.current = false;
        console.error("Whisper error:", e.data.message);
      }
    };

    w.onerror = (err) => console.error("Worker error:", err);
    w.postMessage({ type: "load" });
    onStatusChange?.({ phase: "downloading", progress: 0 });
  }, [onResult, onStatusChange]);

  const sendChunk = useCallback((samples) => {
    if (!workerRef.current || busyRef.current) return;
    busyRef.current = true;
    // copy so we don't hold a reference to the growing buffer
    const chunk = new Float32Array(samples);
    workerRef.current.postMessage({ type: "transcribe", audio: chunk });
  }, []);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ctx  = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioCtxRef.current = ctx;

    const src  = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;

    // reset sample buffer on each new recording session
    samplesRef.current   = [];
    sampleCountRef.current = 0;

    src.connect(proc);
    proc.connect(ctx.destination);

    proc.onaudioprocess = (ev) => {
      const incoming = ev.inputBuffer.getChannelData(0);

      // accumulate samples
      for (let i = 0; i < incoming.length; i++) {
        samplesRef.current.push(incoming[i]);
      }
      sampleCountRef.current += incoming.length;

      // once we have a full chunk, send it
      if (sampleCountRef.current >= CHUNK_SIZE) {
        const chunk = new Float32Array(samplesRef.current);
        samplesRef.current   = [];   // reset for next chunk
        sampleCountRef.current = 0;
        sendChunk(chunk);
      }
    };
  }, [sendChunk]);

  const stop = useCallback(() => {
    // flush any remaining audio that hasn't reached CHUNK_SIZE
    if (samplesRef.current.length > SAMPLE_RATE) {
      // only send if at least 1 second of audio
      sendChunk(new Float32Array(samplesRef.current));
    }
    samplesRef.current     = [];
    sampleCountRef.current = 0;

    procRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, [sendChunk]);

  return { ready, progress, phase, load, start, stop };
}
