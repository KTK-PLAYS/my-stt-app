import { useRef, useCallback, useState } from "react";

export function useWhisper({ onResult, onStatusChange }) {
  const workerRef   = useRef(null);
  const audioCtxRef = useRef(null);
  const procRef     = useRef(null);
  const streamRef   = useRef(null);
  const bufferRef   = useRef([]);
  const fullTextRef = useRef("");

  const [ready,    setReady]    = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase,    setPhase]    = useState("idle");
  // phase: idle | downloading | preparing | ready

  const load = useCallback(() => {
    if (workerRef.current) return;

    const w = new Worker("/whisper-worker.js");
    workerRef.current = w;

    w.onmessage = (e) => {
      const { type, progress: p, text } = e.data;

      if (type === "progress") {
        setProgress(Math.round(p));
        setPhase("downloading");
        onStatusChange?.({ phase: "downloading", progress: Math.round(p) });
      }
      if (type === "preparing") {
        setPhase("preparing");
        onStatusChange?.({ phase: "preparing", progress: 100 });
      }
      if (type === "ready") {
        setReady(true);
        setPhase("ready");
        onStatusChange?.({ phase: "ready", progress: 100 });
      }
      if (type === "result" && text?.trim()) {
        const joined = (fullTextRef.current + " " + text).trim();
        fullTextRef.current = joined;
        onResult({ final: joined, interim: "" });
      }
    };

    w.postMessage({ type: "load" });
    setPhase("downloading");
    onStatusChange?.({ phase: "downloading", progress: 0 });
  }, [onResult, onStatusChange]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const ctx  = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    const src  = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;
    src.connect(proc);
    proc.connect(ctx.destination);
    proc.onaudioprocess = (e) => {
      const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
      bufferRef.current.push(chunk);
      if (bufferRef.current.length > 6) bufferRef.current.shift();
      const total  = bufferRef.current.reduce((s, c) => s + c.length, 0);
      const merged = new Float32Array(total);
      let offset   = 0;
      for (const c of bufferRef.current) { merged.set(c, offset); offset += c.length; }
      workerRef.current?.postMessage({ type: "transcribe", audio: merged });
    };
  }, []);

  const stop = useCallback(() => {
    procRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    bufferRef.current = [];
  }, []);

  return { ready, progress, phase, load, start, stop };
}