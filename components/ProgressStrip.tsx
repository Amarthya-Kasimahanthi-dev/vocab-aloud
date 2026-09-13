"use client";

import type { CardState } from "@/lib/types";

const ROWS: { label: string; boxes: number[] }[] = [
  { label: "Not yet known", boxes: [1] },
  { label: "Getting there", boxes: [2, 3] },
  { label: "Nearly solid", boxes: [4] },
  { label: "Retired", boxes: [5] },
];

/**
 * Shows where every word sits in the Leitner ladder. Each cell is one word,
 * so the shape of the strip is the state of your deck — not decoration.
 */
export default function ProgressStrip({ deck }: { deck: CardState[] }) {
  return (
    <section className="strip" aria-label="Deck progress">
      <div className="strip-rows">
        {ROWS.map((row) => {
          const count = deck.filter((c) => row.boxes.includes(c.box)).length;
          return (
            <div className="strip-row" key={row.label}>
              <span className="strip-label">{row.label}</span>
              <span className="strip-cells">
                {Array.from({ length: count }).map((_, i) => (
                  <span
                    key={i}
                    className={
                      row.label === "Retired" ? "cell cell-filled" : "cell"
                    }
                  />
                ))}
              </span>
              <span className="strip-count">{count}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
