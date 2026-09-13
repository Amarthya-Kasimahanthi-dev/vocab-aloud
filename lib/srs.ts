import type { Box, CardState, Grade, Word } from "./types";

/**
 * Turn-based Leitner. Instead of calendar days we use the session turn
 * counter, so a wrong answer comes back within the same sitting.
 * Gap by box: 1 -> 2 turns, 2 -> 4, 3 -> 7, 4 -> 12, 5 -> retired.
 */
const GAP: Record<Box, number> = { 1: 2, 2: 4, 3: 7, 4: 12, 5: 999 };

export function initDeck(words: Word[]): CardState[] {
  return words.map((w) => ({
    wordId: w.id,
    box: 1,
    attempts: 0,
    correct: 0,
    dueAt: 0,
  }));
}

export function applyGrade(
  card: CardState,
  grade: Grade,
  turn: number
): CardState {
  let box: Box = card.box;

  if (grade.verdict === "correct") {
    box = Math.min(5, card.box + 1) as Box;
  } else if (grade.verdict === "partial") {
    box = card.box;
  } else {
    box = 1;
  }

  return {
    ...card,
    box,
    attempts: card.attempts + 1,
    correct: card.correct + (grade.verdict === "correct" ? 1 : 0),
    dueAt: turn + GAP[box],
  };
}

/**
 * Pick the most overdue card. Unseen cards break ties first so the session
 * keeps introducing new vocabulary instead of drilling the same three words.
 */
export function nextCard(deck: CardState[], turn: number): CardState | null {
  const live = deck.filter((c) => c.box < 5);
  if (live.length === 0) return null;

  const due = live.filter((c) => c.dueAt <= turn);
  const pool = due.length > 0 ? due : live;

  return [...pool].sort((a, b) => {
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    return a.dueAt - b.dueAt;
  })[0];
}

export function mastered(deck: CardState[]): number {
  return deck.filter((c) => c.box >= 5).length;
}

export function accuracy(deck: CardState[]): number {
  const attempts = deck.reduce((s, c) => s + c.attempts, 0);
  if (attempts === 0) return 0;
  const correct = deck.reduce((s, c) => s + c.correct, 0);
  return Math.round((correct / attempts) * 100);
}
