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
//
// The value and reading rules are shared with /turn below, so a slot
// means the same thing whichever endpoint filled it.
const VALUE_RULES = `value      the answer in canonical form, or "" if it cannot be determined.
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
           "Mapo tofu + Egg drop soup", "Explain everything"`;

const READING_RULES = `Work out what the person means, not just what parses. "me and three mates"
is 4 servings. "half an hour" is 30 minutes. "an hour and a half" is 90.
Never invent a dish they did not name. The answer may be lightly garbled:
it came from speech recognition in a kitchen.

For servings and targetTime, a vague quantity ALWAYS needs a follow-up:
"a few", "some", "a handful", "a couple of hours". The serving count
scales every ingredient amount in the plan, so reading "a few people" as
3 when they meant 6 is a shopping list wrong by half — and nobody will
notice until they are cooking. Ask the one short question instead of
guessing. Never return a range in display when value is a single number.`;

const SYSTEM = `You convert one answer from a cooking app's setup conversation into JSON.

${VALUE_RULES}
status     confirmed        the answer is clear
           low-confidence   you had to guess
           needs-followup   you cannot land on a value without asking again
followUp   ONE short question, only when status is needs-followup, else "".
           It must be answerable in a few words and must NOT repeat the
           question already asked.

${READING_RULES}

An answer that does not answer the question at all is needs-followup,
never confirmed: a name or a stray word for diet ("Megan"), no number
for servings or targetTime. When it sounds like a real answer misheard
("Megan" is one sound from "vegan"), the followUp asks whether they
meant that: "Did you mean vegan?".`;

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

/**
 * One call to the gateway, answering JSON to `schema`.
 *
 * Resolves to { content } with the parsed reply, or { status, error } for
 * the route to send back. Rate limits are told apart from breakage: the
 * first is expected on this account and means fall back quietly.
 */
async function askGateway({ system, user, schema, maxTokens, timeoutMs = TIMEOUT_MS }) {
  try {
    const upstream = await fetch(GATEWAY, {
      method: "POST",
      // Raw key. Adding "Bearer" here is the mistake this codebase keeps
      // making in the other direction.
      headers: { authorization: API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        // Reading an answer is extraction, not writing. The same words
        // should give the same slot value every time.
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: schema },
        post_processing_steps: [{ type: "json-repair" }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (upstream.status === 429) {
      return { status: 429, error: { error: "LLM Gateway rate limit", retryable: true } };
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("LLM Gateway error:", upstream.status, detail.slice(0, 300));
      return { status: 502, error: { error: `LLM Gateway returned ${upstream.status}` } };
    }
    const json = await upstream.json();
    return { content: extractJson(json?.choices?.[0]?.message?.content) };
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error("LLM Gateway request failed:", err?.message || err);
    return {
      status: timedOut ? 504 : 502,
      error: { error: timedOut ? "LLM Gateway timed out" : "LLM Gateway unreachable" },
    };
  }
}

const missingKey = (res) =>
  res.status(503).json({
    error: "ASSEMBLYAI_API_KEY is not set on the server; add it to .env and restart.",
  });

understandingRouter.post("/read", async (req, res) => {
  if (!API_KEY) return missingKey(res);

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

  const reply = await askGateway({
    system: SYSTEM,
    user: `Slot: ${clampText(slot, 40)}\n${asked}\nThe cook said: ${clampText(text, 600)}`,
    schema: SCHEMA,
    maxTokens: MAX_TOKENS,
  });
  if (reply.error) return res.status(reply.status).json(reply.error);

  const reading = coerce(reply.content, slot, text);
  if (!reading) return res.status(502).json({ error: "LLM Gateway returned no usable reading" });

  res.set("Cache-Control", "no-store");
  return res.json(reading);
});

// ---------------------------------------------------------------------
// /turn — the whole setup chat as one conversation.
//
// /read took each answer as the answer to one question, in order, so
// once the goose moved on there was no way back: "no, I meant chicken
// stir fry" was read as a number of servings, and "we're not ready for
// servings, talk more about the dishes" got asked for servings again.
//
// Here every turn is read against ALL the slots. The cook can change the
// dishes after giving servings; the goose stays on a topic while they are
// still working it out, suggests when asked, and only moves on once the
// slot is settled or the cook says to. The chat is done when every slot
// has an answer and nothing is still being discussed.

const TURN_SCHEMA = {
  name: "conversation_turn",
  strict: true,
  schema: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slot: { type: "string" },
            value: { type: "string", description: "Empty string for dishIdea." },
            dishes: { type: "array", items: { type: "string" }, description: "dishIdea only; else []." },
            display: { type: "string" },
            status: { type: "string", enum: ["confirmed", "low-confidence"] },
          },
          required: ["slot", "value", "dishes", "display", "status"],
          additionalProperties: false,
        },
      },
      focus: { type: "string", description: "Slot id the conversation is on after this turn." },
      done: { type: "boolean" },
      reply: { type: "string" },
    },
    required: ["updates", "focus", "done", "reply"],
    additionalProperties: false,
  },
};

// A reply can carry a few dish suggestions, and updates can touch
// several slots at once.
const TURN_MAX_TOKENS = 500;
// Enough of the chat to know what was just offered or asked, without
// sending the whole transcript every turn.
const TURN_HISTORY = 12;
// A turn writes a reply, not just a reading: live runs of a follow-up
// with suggestions took 6-7s against /read's 1.3s, too near its 8s. Still
// under the client's 12s, so a stall lands on the local reader.
const TURN_TIMEOUT_MS = 11_000;

const TURN_SYSTEM = `You are Goose, the chef goose running the setup chat of a cooking app.
The chat has one job: land an answer for every slot listed. Treat the whole
chat as ONE conversation. The cook may answer, change or reopen ANY slot at
any time — change the dishes after giving servings, add a dish, fix a
number — and every such change is an update.

Each turn you get the slots in order with the answers so far, the slot in
focus, the recent chat, and what the cook just said. Return JSON:

updates   every slot the cook's words answer or change, each with slot,
          value, dishes, display and status (confirmed, or low-confidence
          when you had to guess), following the value rules below. Only
          when they stated or accepted a value: someone still deciding
          gets no update. A dish you suggested counts once they accept it.
          [] when nothing was settled.
focus     the slot id the conversation is on after this turn. The slots
          are topics of discussion, not a form: the cook leads, and the
          focus follows what they are talking about.
          - FOLLOW THE COOK. When they bring up a different slot than the
            focus — answered or not, earlier or later ("we're not ready for
            servings, talk more about the dishes", "oh, my partner can't do
            peanuts", "how long would that take?") — that slot becomes the
            focus, even if the old focus is still open. Come back to open
            slots later.
          - STAY on the focus slot while the cook is still working it out:
            asking for ideas, undecided, comparing, unhappy with what they
            have, or raising something that needs a follow-up to plan well.
          - MOVE to the first slot, in the order given, that has no answer
            once the focus slot is settled by a clear answer, or when the
            cook says they are happy with it or want to move on.
          A plain, complete answer to the question you asked is itself the
          signal to move on; do not ask "anything else?" about it.
done      true only when every slot has an answer (counting this turn's
          updates) and the cook is not still discussing any of them.
reply     what the goose says next, read aloud in a kitchen: one or two
          short sentences, warm and a little cheeky. Plain text only — no
          markdown, bullets or asterisks; it is spoken. Acknowledge a change
          in a few words. When done, say you are drafting the recipe graph.
          Otherwise end with ONE question about the focus slot:
          - on a slot the cook shifted to or is still working out, a
            FOLLOW-UP that moves that discussion forward and gives some
            guidance — two or three concrete options when they want ideas
            ("chicken stir fry: kung pao, cashew chicken, or a simple
            ginger-scallion?"), or the detail that matters for the plan
            ("is that an allergy? then I'll keep it off every board");
          - on a slot you are moving to, its question in words close to
            the one given.
          Never ask a slot's question again once it has an answer, unless
          the cook brought that slot up.

${VALUE_RULES}

${READING_RULES}
Where these rules say to ask a follow-up, give no update for that slot and
ask it in the reply instead.
Anything that is no answer at all ("okay", "hmm", a stray name) settles
nothing: stay on the focus slot and ask again in different words.`;

const DONE_LINE = "Got it — drafting your recipe graph now.";

/**
 * Force a model turn into the shape the page expects.
 *
 * Every update goes through the same coerce() as /read, so a number is a
 * number and a skill is one of three, whichever endpoint set it. The
 * model does not get to declare the chat done with a slot still empty:
 * that sends it to the first empty slot, with that slot's own question,
 * since a reply written for "done" would be wrong.
 *
 * @param {object} raw     parsed model reply
 * @param {object} ctx
 * @param {Array<{id, question, answer}>} ctx.slots  in order; answer "" when empty
 * @param {string} ctx.focus  slot in focus before this turn
 * @param {string} ctx.said   what the cook said
 */
export function coerceTurn(raw, { slots, focus, said }) {
  if (!raw || typeof raw !== "object") return null;
  const ids = slots.map((s) => s.id);

  const updates = [];
  for (const u of Array.isArray(raw.updates) ? raw.updates : []) {
    if (!u || !ids.includes(u.slot)) continue;
    const reading = coerce(u, u.slot, said);
    if (!reading || reading.value === null || reading.status === "needs-followup") continue;
    // A later update to the same slot in one turn wins.
    const at = updates.findIndex((x) => x.slot === u.slot);
    const entry = { slot: u.slot, value: reading.value, display: reading.display, status: reading.status };
    if (at >= 0) updates[at] = entry;
    else updates.push(entry);
  }

  const filled = new Set(slots.filter((s) => s.answer).map((s) => s.id));
  updates.forEach((u) => filled.add(u.slot));
  const firstOpen = ids.find((id) => !filled.has(id)) ?? null;

  let nextFocus = ids.includes(raw.focus) ? raw.focus : ids.includes(focus) ? focus : firstOpen || ids[0];
  let reply = clampText(String(raw.reply ?? "").trim(), 500);
  const done = raw.done === true && !firstOpen;

  if (raw.done === true && firstOpen) {
    nextFocus = firstOpen;
    reply = slots.find((s) => s.id === firstOpen).question;
  }
  if (!reply) reply = done ? DONE_LINE : slots.find((s) => s.id === nextFocus).question;

  return { updates, focus: done ? null : nextFocus, done, reply, source: "llm" };
}

understandingRouter.post("/turn", async (req, res) => {
  if (!API_KEY) return missingKey(res);

  const { slots, focus, history, text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "text is required" });
  }
  if (!Array.isArray(slots) || !slots.length) {
    return res.status(400).json({ error: "slots are required" });
  }
  const clean = slots.slice(0, 12).map((s) => ({
    id: clampText(s?.id, 40),
    question: clampText(s?.question, 300),
    answer: clampText(s?.answer, 200),
  }));

  const slotLines = clean
    .map((s) => `- ${s.id}: "${s.question}" — ${s.answer ? `answer: ${s.answer}` : "no answer yet"}`)
    .join("\n");
  const chat = (Array.isArray(history) ? history : [])
    .slice(-TURN_HISTORY)
    .map((m) => `${m?.speaker === "cook" ? "Cook" : "Goose"}: ${clampText(m?.text, 400)}`)
    .join("\n");

  const reply = await askGateway({
    system: TURN_SYSTEM,
    user: `Slots, in order:\n${slotLines}\nFocus: ${clampText(focus, 40)}\n\nRecent chat:\n${chat || "(none)"}\n\nThe cook just said: ${clampText(text, 600)}`,
    schema: TURN_SCHEMA,
    maxTokens: TURN_MAX_TOKENS,
    timeoutMs: TURN_TIMEOUT_MS,
  });
  if (reply.error) return res.status(reply.status).json(reply.error);

  const turn = coerceTurn(reply.content, { slots: clean, focus, said: text });
  if (!turn) return res.status(502).json({ error: "LLM Gateway returned no usable turn" });

  res.set("Cache-Control", "no-store");
  return res.json(turn);
});
