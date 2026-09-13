import { NextResponse } from "next/server";
import { WORDS } from "@/lib/words";
import { gradeOffline } from "@/lib/grade";
import type { Grade, TaskKind, Verdict } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// openai/gpt-oss-20b is the fastest current production chat model on Groq
// (~1000 tok/s), which matters because this call sits inside a spoken turn.
// llama-3.3-70b-versatile and llama-3.1-8b-instant moved to enterprise-only
// tiers in 2026 and will 400 on a free key — that is the usual cause of a
// Groq voice agent that "used to work".
const DEFAULT_MODEL = "openai/gpt-oss-20b";

const SYSTEM = `You are a warm, brisk vocabulary coach. Your feedback is READ ALOUD, so:
- Never exceed 30 words.
- No markdown, no lists, no emoji, no stage directions.
- Speak in second person. Be specific about what was right or wrong.
- If the learner is wrong, give the correct meaning plainly rather than hinting.

Grade the learner's spoken answer. The transcript comes from speech recognition,
so ignore punctuation, filler words, and small mishearings. Grade the meaning,
not the wording. A learner who explains the concept in their own words is correct
even if they use none of the dictionary's phrasing.

Reply with ONLY a JSON object, no code fences:
{"verdict":"correct"|"partial"|"incorrect","score":0-100,"feedback":"..."}`;

function buildUserPrompt(
  word: string,
  pos: string,
  definition: string,
  example: string,
  task: TaskKind,
  transcript: string
) {
  const ask =
    task === "define"
      ? `The learner was asked: what does "${word}" mean?`
      : `The learner was asked: use "${word}" in a sentence. A correct answer must contain the word used in its real sense.`;

  return `Word: ${word} (${pos})
Reference definition: ${definition}
Reference example: ${example}
${ask}
Learner said: "${transcript}"`;
}

function extractJson(raw: string): Partial<Grade> | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function coerce(parsed: Partial<Grade>): Grade | null {
  const verdicts: Verdict[] = ["correct", "partial", "incorrect"];
  if (!parsed.verdict || !verdicts.includes(parsed.verdict)) return null;
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
  if (!feedback) return null;

  const rawScore = typeof parsed.score === "number" ? parsed.score : NaN;
  const fallbackScore =
    parsed.verdict === "correct" ? 90 : parsed.verdict === "partial" ? 60 : 20;

  return {
    verdict: parsed.verdict,
    score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : fallbackScore,
    feedback,
    grader: "llm",
  };
}

export async function POST(req: Request) {
  let body: { wordId?: string; task?: TaskKind; transcript?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const { wordId, task, transcript } = body;
  const word = WORDS.find((w) => w.id === wordId);

  if (!word || (task !== "define" && task !== "use") || typeof transcript !== "string") {
    return NextResponse.json(
      { error: "Expected wordId, task ('define' | 'use') and transcript." },
      { status: 400 }
    );
  }

  const key = process.env.GROQ_API_KEY;

  // No key configured: the app is still fully usable.
  if (!key) {
    return NextResponse.json(gradeOffline(word, task, transcript));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        temperature: 0.3,
        max_tokens: 300,
        reasoning_effort: "low",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: buildUserPrompt(
              word.word,
              word.pos,
              word.definition,
              word.example,
              task,
              transcript
            ),
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[tutor] Groq ${res.status}: ${detail.slice(0, 400)}`);
      return NextResponse.json(gradeOffline(word, task, transcript));
    }

    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(raw);
    const grade = parsed ? coerce(parsed) : null;

    if (!grade) {
      console.error(`[tutor] Unparseable model output: ${raw.slice(0, 200)}`);
      return NextResponse.json(gradeOffline(word, task, transcript));
    }

    return NextResponse.json(grade);
  } catch (err) {
    console.error("[tutor] request failed:", err);
    return NextResponse.json(gradeOffline(word, task, transcript));
  } finally {
    clearTimeout(timeout);
  }
}
