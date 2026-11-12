// Runs the Kokoro text-to-speech model off the main thread so the page stays responsive.
// The model (about 90 MB) downloads once from Hugging Face and is then cached by the browser.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

let ttsPromise = null;

function load(id) {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8",
      device: "wasm",
      progress_callback: p => {
        if (p && p.status === "progress" && /\.onnx$/.test(p.file || "") && p.total) {
          self.postMessage({ type: "progress", id, loaded: p.loaded, total: p.total });
        }
      },
    }).catch(e => { ttsPromise = null; throw e; });
  }
  return ttsPromise;
}

self.onmessage = async e => {
  const { id, text, voice } = e.data;
  try {
    const tts = await load(id);
    const out = await tts.generate(text, { voice, speed: 1 });
    const samples = new Float32Array(out.audio);
    self.postMessage({ type: "done", id, samples, rate: out.sampling_rate }, [samples.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", id, message: String((err && err.message) || err) });
  }
};
