// Reads a conversation answer with an LLM, through AssemblyAI's LLM
// Gateway.
//
// Same key as everything else, and it stays on this side: the browser
// posts the question and what was said, and gets back a reading. That is
// the only reason this endpoint exists rather than calling the gateway
// from the page.
//
// AUTH NOTE, because this project already has two conflicting rules for
// the same key: the gateway wants the RAW key in `authorization`, like
// Streaming STT and unlike the Voice Agent API's `Bearer`. Three
// products, two schemes. See CLAUDE.md.
//
// MODEL NOTE. This account only has qwen3.5-4b-32k-fast, which does NOT
// support `response_format` — schema-constrained output is unavailable,
// so the JSON is asked for in the prompt and validated here instead.
// Measured over the four slots it returned clean, correct JSON every
// time at a median of 349ms, so this is workable, but "the model said
// so" is never enough on its own: everything below is checked, coerced
// and clamped before it leaves this file.
//
// RATE LIMIT. The account 429s after roughly two calls in quick
// succession and takes tens of seconds to recover. A real conversation
// paces itself — a person is talking between answers — but this will
// still be hit, which is why the client keeps its regex readers as a
// fallback rather than treating this endpoint as required.
import { Router } from "express";

export const understandingRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.AAI_LLM_GATEWAY_MODEL || "qwen3.5-4b-32k-fast";

// Someone is standing in a kitchen waiting for the next question, so a
// slow read is worse than a crude one — the client falls back to its
// regex readers when this takes too long or fails. Measured max was
// 536ms, so this is generous.
const TIMEOUT_MS = 5000;
const MAX_TOKENS = 200;

const STATUSES = new Set(["confirmed", "low-confidence", "needs-followup"]);

// Spelled out rather than schema-enforced, because this model has no
// response_format. "none" is called out explicitly: the first version of
// this prompt let "no pork please" come back as value "none", which
// reads as "no restrictions" downstream and silently drops the one
// constraint the cook actually gave.
const SYSTEM = `You convert one answer from a cooking app's setup conversation into JSON.

Reply with ONLY a JSON object. No prose, no markdown fence, no explanation.

{"value": string|null, "display": string, "status": "confirmed"|"low-confidence"|"needs-followup", "followUp": string|null}

value      the answer in canonical form, or null if it cannot be determined.
           servings   -> a bare integer, e.g. "4"
           targetTime -> total MINUTES as a bare integer, e.g. "90"
           diet       -> "none" ONLY when there are no restrictions at all.
                         "vegetarian" or "vegan" when that is what they said.
                         Otherwise the constraint itself, in their words
                         ("no pork", "nut allergy"). Never answer "none"
                         when they named a restriction.
           dishIdea   -> the dish name alone
display    short label for the UI, e.g. "4 servings", "90 minutes", "Vegan", "Mapo tofu"
status     confirmed        the answer is clear
           low-confidence   you had to guess
           needs-followup   you cannot land on a value without asking again
followUp   ONE short question, only when status is needs-followup, else null.
           It must be answerable in a few words and must NOT repeat the
           question already asked.

Work out what the person means, not just what parses. "me and three mates"
is 4 servings. "half an hour" is 30 minutes. "an hour and a half" is 90.
Never invent a dish they did not name. The answer may be lightly garbled:
it came from speech recognition in a kitchen.`;

const clampText = (s, max) => String(s ?? "").slice(0, max);

/**
 * Pull a JSON object out of a model reply.
 *
 * It returns a bare object reliably in testing, but "reliably" is not
 * "always" and a fenced or prefaced reply is the common failure. Looking
 * for the outermost braces costs nothing and saves the turn.
 */
function extractJson(raw) {
  if (!raw) return null;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Force a model reply into the shape the page expects.
 *
 * The page stores `value` into the session and renders `display` in the
 * sidecar, so a missing field here becomes a blank slot or a crash three
 * components away. Nothing is trusted: numbers are re-derived for the
 * numeric slots, an unknown status degrades to low-confidence, and a
 * follow-up with nothing to ask stops being a follow-up.
 */
function coerce(reading, slot, said) {
  if (!reading || typeof reading !== "object") return null;

  let value = reading.value == null ? null : String(reading.value).trim();
  let status = STATUSES.has(reading.status) ? reading.status : "low-confidence";
  let followUp = reading.followUp == null ? null : String(reading.followUp).trim();

  // The numeric slots must end up numeric, whatever came back. A model
  // that answers "about 30" for targetTime would otherwise put the
  // string "about 30" where the scheduler expects minutes.
  if (slot === "servings" || slot === "targetTime") {
    const n = value === null ? NaN : Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n) && n > 0) {
      value = String(Math.round(n));
    } else {
      value = null;
      if (status === "confirmed") status = "needs-followup";
    }
  }

  // No value and no question to ask would strand the conversation with
  // nothing on screen and no way forward.
  if (value === null && status !== "needs-followup") status = "needs-followup";
  if (status === "needs-followup" && !followUp) {
    followUp = "Sorry — could you say that another way?";
  }
  if (status !== "needs-followup") followUp = null;

  const display =
    (reading.display == null ? "" : String(reading.display).trim()) ||
    value ||
    clampText(said, 60);

  return { value, display, status, followUp, source: "llm" };
}

understandingRouter.post("/read", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      error: "ASSEMBLYAI_API_KEY is not set on the server; add it to .env and restart.",
    });
  }

  const { slot, question, text, followUpAsked } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  // A follow-up already asked is included so the model can read a bare
  // "three" as the answer to it, rather than as a fresh attempt at the
  // original question.
  const asked = followUpAsked
    ? `Question: ${clampText(question, 300)}\nFollow-up just asked: ${clampText(followUpAsked, 300)}`
    : `Question: ${clampText(question, 300)}`;

  try {
    const upstream = await fetch(GATEWAY, {
      method: "POST",
      // Raw key. Adding "Bearer" here is the mistake this codebase keeps
      // making in the other direction.
      headers: { authorization: API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Reading an answer is extraction, not writing. The same words
        // should give the same slot value every time.
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Slot: ${clampText(slot, 40)}\n${asked}\nThe cook said: ${clampText(text, 600)}`,
          },
        ],
        post_processing_steps: [{ type: "json-repair" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Surfaced distinctly so the client can tell "we are being throttled"
    // from "this is broken" — the first is expected on this account and
    // means fall back quietly, not show an error.
    if (upstream.status === 429) {
      return res.status(429).json({ error: "LLM Gateway rate limit", retryable: true });
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("LLM Gateway error:", upstream.status, detail.slice(0, 300));
      return res.status(502).json({ error: `LLM Gateway returned ${upstream.status}` });
    }

    const json = await upstream.json();
    const reading = coerce(
      extractJson(json?.choices?.[0]?.message?.content),
      slot,
      text,
    );
    if (!reading) return res.status(502).json({ error: "LLM Gateway returned no usable reading" });

    res.set("Cache-Control", "no-store");
    return res.json(reading);
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("LLM Gateway request failed:", err?.message || err);
    return res
      .status(timedOut ? 504 : 502)
      .json({ error: timedOut ? "LLM Gateway timed out" : "LLM Gateway unreachable" });
  }
});
