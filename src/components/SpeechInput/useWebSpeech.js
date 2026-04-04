import { useRef, useCallback } from "react";

export function useWebSpeech({ onResult, onEnd }) {
  const recogRef  = useRef(null);
  const activeRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const r          = new SR();
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = "en-US";
    activeRef.current = true;

    r.onresult = (e) => {
      let interim = "";
      let final   = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        e.results[i].isFinal ? (final += t) : (interim += t);
      }
      onResult({ final, interim });
    };

    r.onerror = (err) => {
      // silently handle — don't surface technical errors to user
      if (err.error === "not-allowed") onEnd?.("permission");
    };

    r.onend = () => {
      if (activeRef.current) {
        try { r.start(); } catch (_) {}
      } else {
        onEnd?.();
      }
    };

    r.start();
    recogRef.current = r;
  }, [onResult, onEnd]);

  const stop = useCallback(() => {
    activeRef.current = false;
    recogRef.current?.stop();
  }, []);

  return { isSupported, start, stop };
}