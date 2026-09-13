"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MicButton from "@/components/MicButton";
import ProgressStrip from "@/components/ProgressStrip";
import { WORDS, wordsByDifficulty } from "@/lib/words";
import { Listener, cancelSpeech, speak, speechSupported, warmVoices } from "@/lib/speech";
import { accuracy, applyGrade, initDeck, nextCard } from "@/lib/srs";
import type { CardState, Grade, Phase, TaskKind, Word } from "@/lib/types";

const STORE_KEY = "vocab-aloud:deck:v1";

const LEVELS: { label: string; max: number }[] = [
  { label: "Everyday", max: 1 },
  { label: "Stretch", max: 2 },
  { label: "All of it", max: 3 },
];

function loadDeck(): CardState[] | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function saveDeck(deck: CardState[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(deck));
  } catch {
    /* private mode, quota, whatever — persistence is a nicety */
  }
}

/**
 * A word's first outing is always "define". Once it has climbed the ladder
 * we switch to production, which is the harder and more useful skill.
 */
function pickTask(card: CardState): TaskKind {
  if (card.attempts === 0) return "define";
  return card.box >= 3 ? "use" : "define";
}

function promptFor(word: Word, task: TaskKind, repeat: boolean): string {
  if (task === "use") {
    return repeat
      ? `Try again. Use ${word.word} in a sentence.`
      : `Use ${word.word} in a sentence.`;
  }
  return repeat
    ? `Once more. What does ${word.word} mean?`
    : `What does ${word.word} mean?`;
}

export default function Page() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(2);

  const [deck, setDeck] = useState<CardState[]>([]);
  const [word, setWord] = useState<Word | null>(null);
  const [task, setTask] = useState<TaskKind>("define");
  const [transcript, setTranscript] = useState("");
  const [grade, setGrade] = useState<Grade | null>(null);
  const [notice, setNotice] = useState("");

  // Refs hold the authoritative session state so the async turn loop never
  // reads a stale closure.
  const deckRef = useRef<CardState[]>([]);
  const turnRef = useRef(0);
  const runRef = useRef(0);
  const cardRef = useRef<CardState | null>(null);
  const listenerRef = useRef<Listener | null>(null);

  useEffect(() => {
    setSupported(speechSupported());
    warmVoices();
    listenerRef.current = new Listener("en-US");
    return () => {
      runRef.current += 1;
      listenerRef.current?.stop();
      cancelSpeech();
    };
  }, []);

  const commitDeck = useCallback((next: CardState[]) => {
    deckRef.current = next;
    setDeck(next);
    saveDeck(next);
  }, []);

  const halt = useCallback(() => {
    runRef.current += 1;
    listenerRef.current?.stop();
    cancelSpeech();
    setRunning(false);
    setPhase("idle");
  }, []);

  const beginTurn = useCallback(async () => {
    const myRun = runRef.current;
    const card = nextCard(deckRef.current, turnRef.current);

    if (!card) {
      setPhase("done");
      setRunning(false);
      return;
    }

    const w = WORDS.find((x) => x.id === card.wordId);
    if (!w) {
      setPhase("done");
      setRunning(false);
      return;
    }

    const t = pickTask(card);
    cardRef.current = card;
    setWord(w);
    setTask(t);
    setTranscript("");
    setGrade(null);
    setNotice("");
    setPhase("asking");

    await speak(promptFor(w, t, card.attempts > 0));
    if (runRef.current !== myRun) return;

    setPhase("listening");
    listenerRef.current?.start({
      onPartial: (text) => {
        if (runRef.current !== myRun) return;
        setTranscript(text);
      },
      onFinal: (text) => {
        if (runRef.current !== myRun) return;
        void resolveTurn(text, myRun);
      },
      onError: (reason) => {
        if (runRef.current !== myRun) return;
        setNotice(reason);
        setPhase("feedback");
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveTurn = useCallback(
    async (text: string, myRun: number) => {
      const card = cardRef.current;
      const w = card ? WORDS.find((x) => x.id === card.wordId) : null;
      if (!card || !w) return;

      setTranscript(text);
      setPhase("grading");

      const t = pickTask(card);
      let result: Grade;

      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordId: w.id, task: t, transcript: text }),
        });
        if (!res.ok) throw new Error(`Grader returned ${res.status}`);
        result = (await res.json()) as Grade;
      } catch {
        result = {
          verdict: "partial",
          score: 50,
          feedback: `The grader is unreachable, so here is the definition: ${w.definition}`,
          grader: "offline",
        };
      }

      if (runRef.current !== myRun) return;

      setGrade(result);
      commitDeck(
        deckRef.current.map((c) =>
          c.wordId === card.wordId ? applyGrade(c, result, turnRef.current) : c
        )
      );
      setPhase("feedback");

      await speak(result.feedback);
      if (runRef.current !== myRun) return;

      await new Promise((r) => setTimeout(r, 450));
      if (runRef.current !== myRun) return;

      turnRef.current += 1;
      void beginTurn();
    },
    [beginTurn, commitDeck]
  );

  const start = useCallback(
    (fresh: boolean) => {
      const pool = wordsByDifficulty(level);
      const saved = fresh ? null : loadDeck();
      const base = initDeck(pool);

      // Merge saved progress for words still in the chosen pool.
      const merged = base.map((c) => {
        const prior = saved?.find((s) => s.wordId === c.wordId);
        return prior ? { ...prior, dueAt: 0 } : c;
      });

      // If everything in the pool is already retired there is nothing to
      // drill, so fall back to a clean deck rather than showing "done".
      const next = merged.some((c) => c.box < 5) ? merged : base;

      runRef.current += 1;
      turnRef.current = 0;
      commitDeck(next);
      setRunning(true);
      void beginTurn();
    },
    [beginTurn, commitDeck, level]
  );

  const toggleMic = useCallback(() => {
    if (phase === "listening") {
      listenerRef.current?.finish();
    } else if (phase === "feedback" || notice) {
      // Retry the same word without waiting for the auto-advance.
      runRef.current += 1;
      cancelSpeech();
      void beginTurn();
    }
  }, [phase, notice, beginTurn]);

  const skip = useCallback(() => {
    if (!running) return;
    runRef.current += 1;
    listenerRef.current?.stop();
    cancelSpeech();
    turnRef.current += 1;
    void beginTurn();
  }, [running, beginTurn]);

  const repeatPrompt = useCallback(async () => {
    if (!word) return;
    listenerRef.current?.stop();
    await speak(promptFor(word, task, false));
    const myRun = runRef.current;
    setPhase("listening");
    listenerRef.current?.start({
      onPartial: (text) => setTranscript(text),
      onFinal: (text) => void resolveTurn(text, myRun),
      onError: (reason) => {
        setNotice(reason);
        setPhase("feedback");
      },
    });
  }, [word, task, resolveTurn]);

  // Space bar mirrors the mic button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = document.activeElement;
      if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) return;
      if (!running) return;
      e.preventDefault();
      toggleMic();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, toggleMic]);

  const hint = (() => {
    if (notice) return "";
    switch (phase) {
      case "asking":
        return "Listen…";
      case "listening":
        return "Speak now. Tap when you're done, or just pause.";
      case "grading":
        return "Checking your answer…";
      case "feedback":
        return "Next word coming up.";
      default:
        return "";
    }
  })();

  const attempts = deck.reduce((s, c) => s + c.attempts, 0);

  if (supported === false) {
    return (
      <main className="shell">
        <header className="masthead">
          <h1 className="masthead-name">Vocab Aloud</h1>
        </header>
        <div className="stage">
          <h2 className="panel-title">This browser can&rsquo;t hear you yet</h2>
          <p className="panel-body">
            Speech recognition is only shipped in Chrome, Edge, and other Chromium
            browsers. Open this page in one of those and the tutor will work.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1 className="masthead-name">Vocab Aloud</h1>
        {running || phase === "done" ? (
          <span className="masthead-stats">
            {attempts} answered · {accuracy(deck)}% right
          </span>
        ) : null}
      </header>

      <div className="stage">
        {!running && phase !== "done" ? (
          <>
            <h2 className="panel-title">Say what the word means.</h2>
            <p className="panel-body">
              The tutor reads a word aloud, listens to your spoken answer, and
              tells you how close you were. Words you miss come back later in the
              same session; words you nail get retired.
            </p>

            <span className="field-label">How hard do you want it?</span>
            <div className="level">
              {LEVELS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  className={level === l.max ? "level-btn level-on" : "level-btn"}
                  onClick={() => setLevel(l.max)}
                >
                  {l.label} · {wordsByDifficulty(l.max).length} words
                </button>
              ))}
            </div>

            <div>
              <button type="button" className="primary" onClick={() => start(false)}>
                Start listening
              </button>
            </div>
            <p className="grader-tag">
              Your browser will ask for microphone access on the first word.
            </p>
          </>
        ) : null}

        {running && word ? (
          <>
            <p className="headword-line">
              <span className="headword">{word.word}</span>
            </p>
            <p className="pos">{word.pos}</p>
            <p className="prompt">
              {task === "use"
                ? `Use it in a sentence.`
                : `What does it mean?`}
            </p>

            <p className={transcript ? "said said-active" : "said"}>
              {transcript || (phase === "listening" ? "…" : "")}
            </p>

            {notice ? <p className="notice">{notice}</p> : null}

            {grade ? (
              <div className={`verdict verdict-${grade.verdict}`}>
                <span className="verdict-mark">
                  {grade.verdict === "correct"
                    ? "Right"
                    : grade.verdict === "partial"
                    ? "Partly there"
                    : "Not this time"}
                </span>
                <p className="verdict-text">{grade.feedback}</p>
                <p className="grader-tag">
                  {grade.grader === "llm"
                    ? "Graded by the language model"
                    : "Graded offline — no GROQ_API_KEY set"}
                </p>
              </div>
            ) : null}

            <div className="controls">
              <MicButton
                listening={phase === "listening"}
                disabled={phase === "asking" || phase === "grading"}
                onClick={toggleMic}
              />
              <span className="hint">{hint}</span>
              <div className="subcontrols">
                <button
                  type="button"
                  className="linkbtn"
                  onClick={repeatPrompt}
                  disabled={phase === "asking" || phase === "grading"}
                >
                  Say it again
                </button>
                <button type="button" className="linkbtn" onClick={skip}>
                  Skip this word
                </button>
                <button type="button" className="linkbtn" onClick={halt}>
                  End session
                </button>
              </div>
            </div>
          </>
        ) : null}

        {phase === "done" ? (
          <>
            <h2 className="panel-title">Deck cleared.</h2>
            <p className="panel-body">
              You retired every word at this level with {accuracy(deck)}% accuracy
              across {attempts} answers. Progress is saved in this browser.
            </p>
            <div>
              <button type="button" className="primary" onClick={() => start(true)}>
                Start over
              </button>
            </div>
          </>
        ) : null}

        {deck.length > 0 ? <ProgressStrip deck={deck} /> : null}
      </div>

      <footer className="foot">
        <p>
          Speech recognition and playback run in your browser. Only the text of
          your answer is sent to the grader.
        </p>
      </footer>
    </main>
  );
}
