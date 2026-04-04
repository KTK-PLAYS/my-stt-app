import { useRef, useCallback } from "react";

export function useWebSpeech({ onResult, onEnd }) {
  const recogRef        = useRef(null);
  const activeRef       = useRef(false);
  const committedRef    = useRef("");   // text already saved to transcript
  const lastInterimRef  = useRef("");   // last interim we showed

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  // ── core dedup function ──────────────────────────────────
  // Given what we already committed and a new string,
  // return only the genuinely new part.
  const extractNew = (committed, incoming) => {
    const c = committed.trim().toLowerCase();
    const i = incoming.trim().toLowerCase();

    // if incoming is entirely contained in what we already have → skip
    if (c.endsWith(i)) return "";

    // if incoming starts with what we already have → return the tail
    if (i.startsWith(c) && c.length > 0) {
      return incoming.trim().slice(c.length).trim();
    }

    // find longest overlapping suffix of committed / prefix of incoming
    const committedWords = committed.trim().split(/\s+/);
    const incomingWords  = incoming.trim().split(/\s+/);

    let bestOverlap = 0;
    const maxCheck  = Math.min(committedWords.length, incomingWords.length, 15);

    for (let len = maxCheck; len >= 1; len--) {
      const tail = committedWords.slice(-len).join(" ").toLowerCase();
      const head = incomingWords.slice(0, len).join(" ").toLowerCase();
      if (tail === head) {
        bestOverlap = len;
        break;
      }
    }

    return incomingWords.slice(bestOverlap).join(" ");
  };

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const r           = new SR();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = "en-US";
    activeRef.current = true;

    r.onresult = (e) => {
      let interimText = "";
      let finalText   = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText.trim()) {
        // deduplicate against everything already committed
        const newPart = extractNew(committedRef.current, finalText);

        if (newPart.trim()) {
          const sep = committedRef.current ? " " : "";
          committedRef.current = committedRef.current + sep + newPart.trim();
          lastInterimRef.current = "";
          onResult({ final: committedRef.current, interim: "" });
        }
      } else if (interimText.trim()) {
        // only show interim if it's not already in committed text
        const alreadyHave = committedRef.current
          .toLowerCase()
          .endsWith(interimText.trim().toLowerCase());

        if (!alreadyHave) {
          lastInterimRef.current = interimText;
          onResult({ final: committedRef.current, interim: interimText });
        }
      }
    };

    r.onerror = (err) => {
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

  // call this when the user clears the transcript
  const resetCommitted = useCallback(() => {
    committedRef.current   = "";
    lastInterimRef.current = "";
  }, []);

  return { isSupported, start, stop, resetCommitted };
}