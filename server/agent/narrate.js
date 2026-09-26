// A few sentences about how the cook actually went.
//
// The summary card is accurate and slightly robotic: counts, ranks,
// minutes, and a headline picked from a table by predicate. That table
// (src/utils/cookQuips.js) is deterministic on purpose -- the same cook
// always gets the same line for the same performance, and reopening the
// card never reshuffles it -- which is exactly right for a scoreboard
// and exactly wrong for the bit people read to each other afterwards.
//
// So this sits BESIDE it rather than replacing it. If the call fails,
// times out, or the key is missing, the card is the card it always was.
// Nothing here is load-bearing.
//
// One call, after the cook, with nobody waiting on a hot pan -- the only
// place in this app where a slower, better model is the right trade.

const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MAX_TOKENS = 300;
// Three sentences of speech is about this. Past it, it stops being a
// remark about the evening and becomes a report.
const MAX_CHARS = 420;
const TIMEOUT_MS = 12_000;

export function buildNarrationPrompt(agentName) {
  return `You are ${agentName}, the sous-chef who worked this cook. It is over. Write two or three sentences about how it went, for the people who were there, in their kitchen diary.

Write it the way someone tells a friend about an evening. Warm, specific, a little funny, never smug.

Rules:
- Use only what is in the record below. Never invent a dish, a time, a mishap or a remark.
- Name people and steps. "Leo spent half the cook on the pork" beats "one cook took a while".
- Notice the interesting thing rather than listing everything: the step that ran long, the hand-back, the dead heat, someone finishing miles ahead.
- No scores or rankings. The card already shows those, and repeating them reads like a receipt.
- No headings, lists, markdown or emoji. Plain sentences.
- Past tense. Do not address the reader as "you".`;
}

/** The run, flattened to what the evening was actually like. */
export function buildNarrationMessage(record = {}) {
  const lines = [
    `Dish: ${record.dish || "an untitled cook"}.`,
    `Mode: ${record.mode === "competition" || record.mode === "versus" ? "versus" : "co-op"}.`,
  ];
  if (record.totalSec) {
    const plan = record.estimatedSec
      ? `, planned for ${minutes(record.estimatedSec)}`
      : "";
    lines.push(`Took ${minutes(record.totalSec)}${plan}.`);
  }
  for (const cook of record.cooks || []) {
    const bits = [`${cook.done ?? 0} steps finished`];
    if (cook.skipped) bits.push(`${cook.skipped} skipped`);
    if (cook.dropped) bits.push(`${cook.dropped} handed back`);
    if (cook.workingSec) bits.push(`${minutes(cook.workingSec)} hands-on`);
    if (cook.longest?.label) {
      bits.push(`longest was ${cook.longest.label} at ${minutes(cook.longest.seconds)}`);
    }
    lines.push(`${cook.name}: ${bits.join(", ")}.`);
  }
  // What each person did, in order, is where the story actually is: the
  // hand-back, the step somebody started twice, who finished first.
  for (const cook of record.cooks || []) {
    const actions = (cook.actions || [])
      .filter((a) => !a.undone && a.label)
      .map((a) => `${a.type} ${a.label}`)
      .slice(0, 12);
    if (actions.length) lines.push(`${cook.name} in order: ${actions.join("; ")}.`);
  }
  return lines.join("\n");
}

function minutes(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "no time at all";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Plain prose, or nothing. Nothing is a fine outcome. */
export function cleanNarration(raw) {
  const text = String(raw ?? "")
    .replace(/[*_`#]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    // A model that returned a list ignored the brief; keeping the
    // bullets would put them on the card.
    .filter((l) => l && !/^[-•\d]+[.)]?\s/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > MAX_CHARS ? "" : text;
}

/**
 * @returns {Promise<{story: string, model: string|null}>} an empty story
 *   means the card keeps its own headline, which is not a failure.
 */
export async function requestNarration({ apiKey, model, agentName, record, timeoutMs = TIMEOUT_MS }) {
  if (!apiKey) return { story: "", model: null };
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildNarrationPrompt(agentName) },
          { role: "user", content: buildNarrationMessage(record) },
        ],
        max_tokens: MAX_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { story: "", model: null };
    const json = await res.json();
    return { story: cleanNarration(json?.choices?.[0]?.message?.content), model };
  } catch {
    return { story: "", model: null };
  }
}
