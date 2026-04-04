importScripts(
  "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js"
);

const { pipeline } = self.Transformers;
let transcriber = null;

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  if (type === "load") {
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        {
          quantized: true,
          progress_callback: (data) => {
            if (data.status === "progress") {
              self.postMessage({ type: "progress", progress: data.progress });
            }
            if (data.status === "initiate") {
              self.postMessage({ type: "progress", progress: 0 });
            }
            if (data.status === "loading") {
              self.postMessage({ type: "preparing" });
            }
          },
        }
      );
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: err.message });
    }
    return;
  }

  if (type === "transcribe" && transcriber) {
    try {
      const result = await transcriber(audio, {
        language: "english",
        return_timestamps: false,
      });
      if (result?.text?.trim()) {
        self.postMessage({ type: "result", text: result.text.trim() });
      }
    } catch (_) {}
  }
};