/**
 * Voice I/O runs entirely in the browser.
 *
 * Why not a hosted STT/TTS model: a round trip to a speech API adds
 * 400-900 ms in each direction on top of the LLM call, needs a mic-recording
 * pipeline (MediaRecorder -> blob -> multipart upload), and puts two more
 * paid, deprecation-prone models between you and a working demo. The Web
 * Speech API is streaming, free, and has no key. Swap it out later if you
 * need voice quality or non-Chrome support — see `transcribeRemote` below.
 */

export function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  const hasSTT = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasTTS = "speechSynthesis" in window;
  return hasSTT && hasTTS;
}

type ListenHandlers = {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (reason: string) => void;
};

export class Listener {
  private rec: SpeechRecognition | null = null;
  private finalText = "";
  private settled = false;

  constructor(private lang = "en-US") {}

  start(handlers: ListenHandlers) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      handlers.onError("This browser has no speech recognition. Use Chrome or Edge.");
      return;
    }

    this.stop();
    this.finalText = "";
    this.settled = false;

    const rec = new Ctor();
    rec.lang = this.lang;
    // continuous:false lets the browser end the turn on its own silence
    // detection, which is what you want for question-and-answer.
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      handlers.onPartial((this.finalText + " " + interim).trim());
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (this.settled) return;
      this.settled = true;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        handlers.onError("Microphone access was blocked. Allow it in the address bar and try again.");
      } else if (e.error === "no-speech") {
        handlers.onError("I didn't hear anything.");
      } else if (e.error === "aborted") {
        // User-initiated stop. Let onend deliver whatever was captured.
        this.settled = false;
      } else {
        handlers.onError(`Speech recognition failed: ${e.error}`);
      }
    };

    rec.onend = () => {
      if (this.settled) return;
      this.settled = true;
      const text = this.finalText.trim();
      if (text) handlers.onFinal(text);
      else handlers.onError("I didn't hear anything.");
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      handlers.onError("Could not start the microphone. Is another tab already listening?");
    }
  }

  /** Ends the turn and lets whatever was captured through. */
  finish() {
    try {
      this.rec?.stop();
    } catch {
      /* already stopped */
    }
  }

  /** Hard cancel. Discards the turn. */
  stop() {
    if (!this.rec) return;
    this.settled = true;
    try {
      this.rec.abort();
    } catch {
      /* already stopped */
    }
    this.rec = null;
  }
}

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Prefer a natural-sounding local English voice over the robotic defaults.
  const ranked = [
    (v: SpeechSynthesisVoice) => /en-(US|GB)/i.test(v.lang) && /natural|neural|google/i.test(v.name),
    (v: SpeechSynthesisVoice) => /en-(US|GB)/i.test(v.lang) && v.localService,
    (v: SpeechSynthesisVoice) => /^en/i.test(v.lang),
  ];
  for (const test of ranked) {
    const hit = voices.find(test);
    if (hit) {
      cachedVoice = hit;
      return hit;
    }
  }
  return voices[0] ?? null;
}

/** Voices populate asynchronously in Chrome. Call once on mount. */
export function warmVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickVoice();
  };
}

export function cancelSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/**
 * Speaks `text` and resolves when playback ends. Always resolves — a hung
 * utterance must not stall the session state machine, so there is a timeout
 * sized to the length of the text.
 */
export function speak(text: string, rate = 0.98): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || "en-US";
    u.rate = rate;
    u.pitch = 1;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(keepAlive);
      clearTimeout(bail);
      resolve();
    };

    u.onend = finish;
    u.onerror = finish;

    // Chrome silently pauses synthesis after ~15 s. Pinging resume keeps
    // long feedback sentences from cutting off mid-word.
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    }, 5000);

    // ~11 chars/sec at rate 1, plus headroom.
    const bail = setTimeout(finish, (text.length / 11) * 1000 * (1 / rate) + 4000);

    window.speechSynthesis.speak(u);
  });
}

/**
 * Placeholder for a server-side STT upgrade path.
 *
 * If you later need Safari/Firefox support or better accuracy, record with
 * MediaRecorder, POST the blob to an /api/transcribe route, and have that
 * route forward it to Groq's whisper-large-v3-turbo (still a production
 * model, ~$0.04/hr). The rest of the state machine does not change — only
 * this function's implementation does.
 */
export async function transcribeRemote(_audio: Blob): Promise<string> {
  throw new Error("Remote transcription is not wired up in this prototype.");
}
