export type Difficulty = 1 | 2 | 3;

export interface Word {
  id: string;
  word: string;
  pos: string;
  definition: string;
  example: string;
  /** Content words a correct answer tends to contain. Used by the offline grader. */
  keys: string[];
  difficulty: Difficulty;
}

/** The two things the tutor can ask you to do with a word. */
export type TaskKind = "define" | "use";

export type Verdict = "correct" | "partial" | "incorrect";

export interface Grade {
  verdict: Verdict;
  /** 0-100. Drives the spaced-repetition box move. */
  score: number;
  /** One or two spoken sentences. Kept short because it is read aloud. */
  feedback: string;
  /** Where the grade came from, surfaced in the UI so you can tell if the LLM is live. */
  grader: "llm" | "offline";
}

/** Leitner box 1-5. Box 1 = seen it and got it wrong, box 5 = retired. */
export type Box = 1 | 2 | 3 | 4 | 5;

export interface CardState {
  wordId: string;
  box: Box;
  attempts: number;
  correct: number;
  /** Session-relative turn index at which this card becomes eligible again. */
  dueAt: number;
}

export type Phase =
  | "idle"
  | "asking"
  | "listening"
  | "grading"
  | "feedback"
  | "done";
