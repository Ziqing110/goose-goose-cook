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
// MODEL NOTE. claude-sonnet-4-6 — the same model recipes.js uses, so
// the two jobs cannot drift apart in how they read a dish name.
// Benchmarked over ten known-answer cases:
//
//   gemini-2.5-flash-lite      10/10   654ms   (cheapest)
//   gemini-3.5-flash-lite      10/10   896ms
//   claude-sonnet-4-6          10/10  1291ms   <- chosen
//   claude-haiku-4-5            9/10  3462ms
//
// Ten cases cannot separate two models that both score perfectly, so
// this is not a measured win over the Gemini pair — it is a deliberate
// trade of roughly 600ms for the more capable model on the messy, real,
// half-garbled speech that a ten-case bench does not contain. Haiku is
// ruled out on the numbers: less accurate AND slower.
//
// If the extra latency ever shows in a real conversation, swap
// AAI_LLM_GATEWAY_MODEL to gemini-2.5-flash-lite; it needs no code
// change, because the schema below is deliberately portable.
//
// "The model said so" is still never enough: everything below is
// checked, coerced and clamped before it leaves this file.
import { Router } from "express";

export const understandingRouter = Router();

const API_KEY = process.env.ASSEMBLYAI_API_KEY || "";
const GATEWAY = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const MODEL = process.env.AAI_LLM_GATEWAY_MODEL || "claude-sonnet-4-6";

// Single-typed fields throughout. A union like ["string","array","null"]
// is accepted by Anthropic's schema validator and rejected outright by
// Gemini's and OpenAI's ("Invalid JSON payload") — which silently turns
// a model choice into a validator choice. Dishes therefore get their own
// array field rather than overloading `value`, and "absent" is the empty
// string rather than null.
const SCHEMA = {
  name: "answer_reading",
  strict: true,
  schema: {
    type: "object",
    properties: {
      value: { type: "string", description: "Empty string when there is no value yet." },
      dishes: {
        type: "array",
        items: { type: "string" },
        description: "Dish names, for the dishIdea slot only. Empty array otherwise.",
      },
      display: { type: "string" },
      status: { type: "string", enum: ["confirmed", "low-confidence", "needs-followup"] },
      followUp: { type: "string", description: "Empty string unless status is needs-followup." },
    },
    required: ["value", "dishes", "display", "status", "followUp"],
    additionalProperties: false,
  },
};

// Someone is standing in a kitchen waiting for the next question, so a
// slow read is worse than a crude one — the client falls back to its
// regex readers when this takes too long or fails. Sonnet's median is
// 1291ms and a cold first call ran 4s, so the budget has to clear that
// without being so long that a stalled call holds up the conversation.
const TIMEOUT_MS = 8000;
const MAX_TOKENS = 200;

const STATUSES = new Set(["confirmed", "low-confidence", "needs-followup"]);
const SKILL_LEVELS = new Set(["beginner", "regular", "confident"]);

// The schema fixes the shape; this fixes the meaning. "none" is called
// out explicitly: the first version of
// this prompt let "no pork please" come back as value "none", which
// reads as "no restrictions" downstream and silently drops the one
// constraint the cook actually gave.
const SYSTEM = `You convert one answer from a cooking app's setup conversation into JSON.

value      the answer in canonical form, or "" if it cannot be determined.
           servings   -> a bare integer, e.g. "4"
           targetTime -> total MINUTES as a bare integer, e.g. "90"
           diet       -> "none" ONLY when there are no restrictions at all.
                         "vegetarian" or "vegan" when that is what they said.
                         Otherwise the constraint itself, in their words
                         ("no pork", "nut allergy"). Never answer "none"
                         when they named a restriction.
           dishIdea   -> leave value "" and put the names in the dishes
                         field. Names only, no quantities or method.
                         Watch for dish names containing "and":
                         "macaroni and cheese" is ONE dish, not two.
           skill      -> how much each step should EXPLAIN:
                         "beginner"  = explain everything, they are new to this
                         "regular"   = normal detail
                         "confident" = just the essentials, they only need
                                       reminding, not teaching
                         Naming the levels without defining them made every
                         model read "just the essentials thanks" as beginner.
                         This is about explanation, never about ability:
                         a beginner may attempt any dish, however hard.
                         Never use it to discourage or refuse a dish.
display    short label for the UI, e.g. "4 servings", "90 minutes", "Vegan",
           "Mapo tofu + Egg drop soup", "Explain everything"
status     confirmed        the answer is clear
           low-confidence   you had to guess
           needs-followup   you cannot land on a value without asking again
followUp   ONE short question, only when status is needs-followup, else "".
           It must be answerable in a few words and must NOT repeat the
           question already asked.

Work out what the person means, not just what parses. "me and three mates"
is 4 servings. "half an hour" is 30 minutes. "an hour and a half" is 90.
Never invent a dish they did not name. The answer may be lightly garbled:
it came from speech recognition in a kitchen.

For servings and targetTime, a vague quantity ALWAYS needs a follow-up:
"a few", "some", "a handful", "a couple of hours". The serving count
scales every ingredient amount in the plan, so reading "a few people" as
3 when they meant 6 is a shopping list wrong by half — and nobody will
notice until they are cooking. Ask the one short question instead of
guessing. Never return a range in display when value is a single number.`;

const clampText = (s, max) => String(s ?? "").slice(0, max);

// Deliberately mirrors readSkill() in src/utils/understanding.js, so the
// LLM path and the offline fallback land on the same level for the same
// words. If you change one, change the other.
function skillFromKeywords(said) {
  const t = String(said || "").toLowerCase();
  if (/\b(beginner|new|never|first time|learning|explain everything|no idea|novice)\b/.test(t)) return "beginner";
  if (/\b(confident|experienced|expert|pro|chef|essentials|skip|brief|terse)\b/.test(t)) return "confident";
  if (/\b(regular|normal|some|average|fine|okay|ok|decent|standard)\b/.test(t)) return "regular";
  return null;
}

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

  // "" is how the schema says "no value" — it has no nulls, because a
  // nullable union is exactly what the Gemini validator rejects.
  let value = reading.value == null || reading.value === "" ? null : reading.value;

  // The model sometimes nests the answer under the slot name:
  //   {"value": {"dishIdea": ["mapo tofu", "egg drop soup"]}}
  // Observed on every dishIdea call. Without unwrapping, the array
  // handling below stringifies the wrapper and writes "[object Object]"
  // into the session.
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const inner = value[slot] ?? Object.values(value)[0];
    value = inner === undefined ? null : inner;
  }
  let status = STATUSES.has(reading.status) ? reading.status : "low-confidence";
  let followUp = reading.followUp ? String(reading.followUp).trim() : null;

  // dishIdea is a list whatever the model felt like returning. A bare
  // string here would reach matchTemplates as a single dish and quietly
  // lose the second one.
  if (slot === "dishIdea") {
    // The schema gives dishes their own array field, so prefer it. The
    // `value` fallback covers a model that answered in the old shape.
    const raw = Array.isArray(reading.dishes) && reading.dishes.length ? reading.dishes : value;
    const list = (Array.isArray(raw) ? raw : [raw])
      .filter((d) => d != null)
      .map((d) => String(d).trim())
      .filter(Boolean);
    value = list.length ? list : null;
  } else if (value !== null) {
    value = String(value).trim();
  }

  // skill is a closed three-value set, and this model is measurably bad
  // at it: "just the essentials thanks" came back "regular" when the
  // prompt names "essentials" under confident. A keyword the person
  // actually said beats a 4B model's guess, so an unambiguous word wins
  // outright. Anything unrecognised becomes the middle setting, which is
  // the safe miss — it neither buries an expert nor strands a beginner.
  if (slot === "skill") {
    const keyword = skillFromKeywords(said);
    if (keyword) value = keyword;
    else if (value === null || !SKILL_LEVELS.has(value)) {
      value = "regular";
      if (status === "confirmed") status = "low-confidence";
    }
  }

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

  // Always a string: `value` may now be an array, and an array landing in
  // the sidecar would render as "mapo tofu,egg drop soup".
  const display =
    (reading.display == null ? "" : String(reading.display).trim()) ||
    (Array.isArray(value) ? value.join(" + ") : value) ||
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
        response_format: { type: "json_schema", json_schema: SCHEMA },
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
