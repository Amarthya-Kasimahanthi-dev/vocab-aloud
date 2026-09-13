# Vocab Aloud

A voice agent that drills vocabulary. It reads a word aloud, listens to your
spoken answer, grades the meaning, and speaks feedback back. Words you miss
return later in the session; words you nail get retired.

Runs with **no API key at all**. A Groq key upgrades the grader from a keyword
heuristic to an LLM.

---

## Run it

```bash
npm install
npm run dev
```


Next 16 / React 19, pinned. Earlier Next majors (14.x and 15.x) are all inside
an open critical advisory range at the time of writing; `npm audit` on this
tree returns zero vulnerabilities.

### Optional: better grading

```bash
cp .env.example .env.local
# paste a free key from https://console.groq.com/keys
```

Restart the dev server. The UI shows which grader answered under each verdict,
so you can tell at a glance whether the LLM is actually live.

---

## Why the voice runs in the browser

The obvious build is mic → hosted speech-to-text → LLM → hosted text-to-speech →
speaker. That is the design that keeps breaking, for three reasons:

1. **Latency compounds.** Each hosted hop adds 400–900 ms on top of the LLM
   call. A spoken turn that takes three seconds feels broken.
2. **The recording pipeline is the bug farm.** MediaRecorder codec differences,
   multipart upload shapes, and file-extension sniffing on the server side
   account for most "it returns 400 and I don't know why" reports.
3. **Hosted speech models churn.** Groq's `playai-tts` was deprecated in
   December 2025 and replaced by Canopy Labs Orpheus. `llama-3.3-70b-versatile`
   and `llama-3.1-8b-instant` moved to enterprise-only tiers in June 2026 and
   now return `model_decommissioned` on a free key. If your agent worked and
   then stopped, that is almost certainly why.

The Web Speech API is streaming, free, needs no key, and cannot be deprecated
out from under you. It costs you non-Chromium browser support and some voice
quality. For a prototype that is the right trade.

`lib/speech.ts` isolates every voice call behind two objects (`Listener` and
`speak`). Swapping in hosted speech later means rewriting that one file — the
state machine above it does not change. The upgrade path is sketched in
`transcribeRemote()`.

---

## How the session works

```
        ┌──────── beginTurn ────────┐
        ▼                           │
   pick card (SRS)                  │
        ▼                           │
   speak the prompt   ── phase: asking
        ▼                           │
   listen            ── phase: listening
        ▼                           │
   POST /api/tutor    ── phase: grading
        ▼                           │
   move card in Leitner ladder      │
        ▼                           │
   speak feedback     ── phase: feedback
        └───────────────────────────┘
```

**Scheduling** (`lib/srs.ts`) is a turn-based Leitner system. Five boxes; a
correct answer promotes the card, an incorrect one sends it to box 1, a partial
holds it. The delay before a card returns is measured in *turns within the
session*, not calendar days, so a word you fluff comes back two questions later
rather than tomorrow. A card in box 5 is retired.

**Task selection**: a word's first outing is always "define it". Once it reaches
box 3 the tutor switches to "use it in a sentence", which is the harder and more
transferable skill.

**Grading** (`app/api/tutor/route.ts`) sends the reference definition, the task,
and the transcript to the LLM and asks for `{verdict, score, feedback}`. Every
failure path — no key, non-200, timeout, unparseable JSON — falls through to
`gradeOffline()` instead of erroring. The prototype is never dead.

**Offline grader** (`lib/grade.ts`) stems the transcript and counts overlap
against the `keys` array on each word. Two hits is a pass on a definition task.
For sentence tasks it checks the word actually appears and the sentence has
substance. Crude, but it makes the app demoable with zero setup, and it is a
useful regression baseline for the LLM.

**Concurrency**: `runRef` is a generation counter. Every control that
interrupts a turn — skip, stop, retry — increments it, and every async
continuation checks it before touching state. That is what stops a
half-finished `speak()` from resuming a session the user already ended.

---

## Layout

```
app/
  page.tsx              session state machine + UI
  layout.tsx            fonts, metadata
  globals.css           all styles
  api/tutor/route.ts    grading endpoint
lib/
  types.ts              shared shapes
  words.ts              the word bank
  speech.ts             STT/TTS wrappers — the only browser-API surface
  srs.ts                Leitner scheduler
  grade.ts              offline grader
components/
  MicButton.tsx
  ProgressStrip.tsx
types/
  speech.d.ts           Web Speech API declarations (not in TS's DOM lib)
```

Adding words means appending to `WORDS` in `lib/words.ts`. Give each entry good
`keys` — the offline grader is only as good as those.

---

## Deploy to Vercel

```bash
git init && git add -A && git commit -m "vocab voice agent"
gh repo create vocab-voice-agent --private --source=. --push
```

Then import the repo at vercel.com. No build configuration needed.

If you want LLM grading in production, add `GROQ_API_KEY` under
**Settings → Environment Variables** and redeploy. Without it the deployed app
still works on the offline grader.

The mic requires a secure context. `localhost` and every `*.vercel.app` domain
qualify, so this works in both places — but it will silently fail if you serve
it over plain `http://` on a LAN IP.

---

## Known limits

- Chromium only. Recognition quality varies with accent and mic.
- Chrome's recognition sends audio to Google's servers. The footer says so.
- Progress lives in `localStorage`, so it is per-browser and not per-user.
- 24 words. It is a prototype.
