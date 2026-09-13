import type { Grade, TaskKind, Word } from "./types";

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "he", "her", "him", "his", "i", "if", "in", "into", "is", "it", "its",
  "like", "me", "my", "not", "of", "on", "or", "our", "out", "she", "so",
  "some", "something", "someone", "that", "the", "their", "them", "then",
  "there", "they", "this", "to", "up", "us", "very", "was", "we", "were",
  "what", "when", "which", "who", "will", "with", "would", "you", "your",
  "means", "meaning", "word", "think", "kind", "sort", "thing", "when",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** Crude suffix stripping. Enough to match "recovers" to "recover". */
function stem(t: string): string {
  return t
    .replace(/(ness|ments|ment|ingly|edly|ing|ies|ied|es|ed|ly|s)$/i, "")
    .replace(/i$/, "y");
}

function overlap(answer: string[], keys: string[]): number {
  const a = new Set(answer.map(stem));
  let hits = 0;
  for (const k of keys) if (a.has(stem(k.toLowerCase()))) hits += 1;
  return hits;
}

/**
 * Deterministic fallback grader. It is deliberately lenient on `define`
 * (any two key concepts is a pass) and structural on `use` (the word must
 * actually appear in a sentence of reasonable length).
 */
export function gradeOffline(
  word: Word,
  task: TaskKind,
  transcript: string
): Grade {
  const text = transcript.trim();
  const toks = tokens(text);

  if (toks.length === 0) {
    return {
      verdict: "incorrect",
      score: 0,
      feedback: `I didn't catch an answer. ${word.word} means: ${word.definition}`,
      grader: "offline",
    };
  }

  if (task === "use") {
    // Match the word allowing for inflection: "resilient" also matches
    // "resiliently", "capitulate" also matches "capitulated".
    const root = word.word.replace(/(ate|ize|ise|ous|ent|ant|ic|al|e)$/i, "");
    const stub = root.length >= 4 ? root : word.word;
    const usedWord = new RegExp(`\\b${stub}`, "i").test(text);
    const words = text.trim().split(/\s+/).length;

    // The offline grader cannot judge whether a sentence uses the word in the
    // right SENSE — only whether a real sentence was produced. It is lenient
    // on purpose. Sense-checking is the LLM grader's job.
    if (usedWord && words >= 6 && toks.length >= 3) {
      return {
        verdict: "correct",
        score: 88,
        feedback: `That works as a sentence. Compare with: ${word.example}`,
        grader: "offline",
      };
    }
    if (usedWord) {
      return {
        verdict: "partial",
        score: 55,
        feedback: `Give me a fuller sentence around ${word.word}. Like this: ${word.example}`,
        grader: "offline",
      };
    }
    return {
      verdict: "incorrect",
      score: 20,
      feedback: `I need a sentence that actually contains ${word.word}. For example: ${word.example}`,
      grader: "offline",
    };
  }

  const hits = overlap(toks, word.keys);
  if (hits >= 2) {
    return {
      verdict: "correct",
      score: 92,
      feedback: `That's it. ${word.word}: ${word.definition}`,
      grader: "offline",
    };
  }
  if (hits === 1) {
    return {
      verdict: "partial",
      score: 55,
      feedback: `Close. The fuller meaning is: ${word.definition}`,
      grader: "offline",
    };
  }
  return {
    verdict: "incorrect",
    score: 15,
    feedback: `Not quite. ${word.word} means: ${word.definition}`,
    grader: "offline",
  };
}
