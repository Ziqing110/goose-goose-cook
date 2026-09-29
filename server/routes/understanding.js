// Reads the setup chat with an LLM: every spoken turn is read against ALL
// the setup questions at once, so any answer can be given, changed or
// reopened at any time, and the reply says where the chat goes next.
//
// MODEL NOTE. claude-sonnet-4-6, benchmarked over ten known-answer cases:
//
//   gemini-2.5-flash-lite      10/10   654ms   (cheapest)
//   gemini-3.5-flash-lite      10/10   896ms
//   claude-sonnet-4-6          10/10  1291ms   <- chosen
//   claude-haiku-4-5            9/10  3462ms
//
// Ten cases cannot separate models that all score perfectly, so this is a
// deliberate trade of ~600ms for the more capable model on messy, real,
// half-garbled speech. Swap AAI_LLM_GATEWAY_MODEL to change it; the schema
// is deliberately portable.
//
// "The model said so" is never enough: every update is checked, coerced
// and clamped before it leaves this file.
import { Router } from "express";
import { chat, extractJson, sendError } from "../llm.js";
import { skillKeyword } from "../../src/utils/understanding.js";

export const understandingRouter = Router();

const MODEL = process.env.AAI_LLM_GATEWAY_MODEL || "claude-sonnet-4-6";

// A reply can carry a few dish suggestions, and updates can touch
// several slots at once.
const MAX_TOKENS = 500;
// Enough of the chat to know what was just offered or asked, without
// sending the whole transcript every turn.
const HISTORY_TURNS = 12;
// Under the client's 12s, so a stall lands on the local reader. A turn
// with suggestions measured 6-7s.
const TIMEOUT_MS = 11_000;

const STATUSES = new Set(["confirmed", "low-confidence"]);
const SKILL_LEVELS = new Set(["beginner", "regular", "confident"]);
const NUMERIC_SLOTS = new Set(["servings", "targetTime"]);

// Single-typed fields throughout. A union like ["string","null"] is
// accepted by Anthropic's schema validator and rejected outright by
// Gemini's and OpenAI's, which would silently turn a model choice into a
// validator choice. So dishes get their own array field, and "absent" is
// the empty string rather than null.
const SCHEMA = {
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
            status: { type: "string", enum: [...STATUSES] },
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

// "none" is called out explicitly: an earlier prompt let "no pork please"
// come back as "none", which reads as "no restrictions" downstream and
// drops the one constraint the cook actually gave.
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
3 when they meant 6 is a shopping list wrong by half. Ask the one short
question instead of guessing. Never return a range in display when value
is a single number.`;

const SYSTEM = `You are Goose, the chef goose running the setup chat of a cooking app.
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

const clampText = (s, max) => String(s ?? "").slice(0, max);

/**
 * One model update, forced into a value the page can store, or null when
 * it holds no usable value. Numbers are re-derived for the numeric slots,
 * dishes are always a list, and skill is always one of three levels.
 */
function coerceUpdate(update, said) {
  const { slot } = update;
  let value = update.value === "" || update.value == null ? null : update.value;
  // Models sometimes nest the answer under the slot name:
  // {"value": {"dishIdea": [...]}}. Unwrap it rather than store
  // "[object Object]".
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = value[slot] ?? Object.values(value)[0] ?? null;
  }
  let status = STATUSES.has(update.status) ? update.status : "low-confidence";

  if (slot === "dishIdea") {
    const raw = Array.isArray(update.dishes) && update.dishes.length ? update.dishes : value;
    const list = [raw].flat().filter((d) => d != null).map((d) => String(d).trim()).filter(Boolean);
    value = list.length ? list : null;
  } else if (value !== null) {
    value = String(value).trim() || null;
  }

  // A keyword the cook actually said beats the model's guess. Anything
  // unrecognised becomes the middle setting, the safe miss.
  if (slot === "skill") {
    const keyword = skillKeyword(said);
    if (keyword) value = keyword;
    else if (!SKILL_LEVELS.has(value)) {
      value = "regular";
      status = "low-confidence";
    }
  }

  // "about 30" must not reach the scheduler as a string.
  if (NUMERIC_SLOTS.has(slot)) {
    const n = value === null ? NaN : Number(String(value).replace(/[^\d.-]/g, ""));
    value = Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null;
  }

  if (value === null) return null;
  const display =
    String(update.display ?? "").trim() || (Array.isArray(value) ? value.join(" + ") : value);
  return { slot, value, display, status };
}

/**
 * Force a model turn into the shape the page expects. The model does not
 * get to declare the chat done with a slot still empty: that sends it to
 * the first empty slot, with that slot's own question.
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
  const questionOf = (id) => slots.find((s) => s.id === id).question;

  // A later update to the same slot in one turn wins.
  const bySlot = new Map();
  for (const u of Array.isArray(raw.updates) ? raw.updates : []) {
    if (!u || !ids.includes(u.slot)) continue;
    const update = coerceUpdate(u, said);
    if (update) bySlot.set(u.slot, update);
  }
  const updates = [...bySlot.values()];

  const filled = new Set([...slots.filter((s) => s.answer).map((s) => s.id), ...bySlot.keys()]);
  const firstOpen = ids.find((id) => !filled.has(id)) ?? null;
  const done = raw.done === true && !firstOpen;

  let nextFocus = ids.includes(raw.focus) ? raw.focus : ids.includes(focus) ? focus : firstOpen || ids[0];
  let reply = clampText(String(raw.reply ?? "").trim(), 500);
  if (raw.done === true && firstOpen) {
    nextFocus = firstOpen;
    reply = questionOf(firstOpen);
  }
  if (!reply) reply = done ? DONE_LINE : questionOf(nextFocus);

  return { updates, focus: done ? null : nextFocus, done, reply, source: "llm" };
}

understandingRouter.post("/turn", async (req, res) => {
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
  const chatLines = (Array.isArray(history) ? history : [])
    .slice(-HISTORY_TURNS)
    .map((m) => `${m?.speaker === "cook" ? "Cook" : "Goose"}: ${clampText(m?.text, 400)}`)
    .join("\n");

  try {
    const choice = await chat({
      model: MODEL,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      // Reading an answer is extraction: the same words should give the
      // same slot value every time.
      temperature: 0,
      schema: SCHEMA,
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Slots, in order:\n${slotLines}\nFocus: ${clampText(focus, 40)}\n\nRecent chat:\n${chatLines || "(none)"}\n\nThe cook just said: ${clampText(text, 600)}`,
        },
      ],
    });
    const turn = coerceTurn(extractJson(choice?.message?.content), { slots: clean, focus, said: text });
    if (!turn) return res.status(502).json({ error: "LLM Gateway returned no usable turn" });
    res.set("Cache-Control", "no-store");
    return res.json(turn);
  } catch (err) {
    console.error("Setup chat turn failed:", err.message);
    return sendError(res, err);
  }
});
