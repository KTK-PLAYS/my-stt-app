let transcriber = null;

async function loadTransformers() {
  const module = await import(
    "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js"
  );
  return module;
}

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  if (type === "load") {
    try {
      self.postMessage({ type: "progress", progress: 0 });
      const { pipeline, env } = await loadTransformers();
      env.allowLocalModels = false;
      env.useBrowserCache  = true;
      self.postMessage({ type: "progress", progress: 10 });

      transcriber = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        {
          quantized: true,
          progress_callback: (data) => {
            if (data.status === "progress") {
              const mapped = 10 + Math.round((data.progress ?? 0) * 0.85);
              self.postMessage({ type: "progress", progress: mapped });
            }
            if (data.status === "loading") {
              self.postMessage({ type: "preparing" });
              self.postMessage({ type: "progress", progress: 95 });
            }
          },
        }
      );

      self.postMessage({ type: "progress", progress: 100 });
      self.postMessage({ type: "ready" });

    } catch (err) {
      self.postMessage({ type: "error", message: err.message });
    }
    return;
  }

  if (type === "transcribe" && transcriber) {
    try {
      const result = await transcriber(audio, {
        language:          "english",
        return_timestamps: false,
        // suppress hallucination tokens
        suppress_tokens:   [],
        no_speech_threshold: 0.6,       // ← ignore segments where model is unsure
        compression_ratio_threshold: 2.4,
        condition_on_previous_text: false, // ← stops it echoing previous words
      });

      const raw  = (result?.text ?? "").trim();

      // strip ALL [BLANK_AUDIO], [INAUDIBLE], dots, brackets etc.
      const clean = raw
        .replace(/\[.*?\]/g, "")          // remove [BLANK_AUDIO] [INAUDIBLE] etc
        .replace(/\(\s*\)/g, "")          // remove ()
        .replace(/\.{2,}/g, "")           // remove multiple dots
        .replace(/\s{2,}/g, " ")          // collapse spaces
        .trim();

      if (clean.length > 1) {
        self.postMessage({ type: "result", text: clean });
      }
      // if nothing real was said — send nothing, don't post empty result

    } catch (_) {}
  }
};