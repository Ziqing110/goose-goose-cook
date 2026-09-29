// One line of banter on talk that was not meant for the goose.
//
// A sibling of aside.js rather than a mode on it: an aside is about the
// run, into silence; this is about what the cooks just said to each
// other, into a conversation. Same shape otherwise -- no tools, one
// short line or nothing, and every failure is silence.
//
// Whether it may happen at all is decided in the browser
// (src/utils/banter.js). Most calls should still come back empty: the
// model is the second, softer filter.

import { chat } from "../llm.js";
import { cleanAside } from "./aside.js";

const MAX_TOKENS = 80;
// Banter that lands late is worse than none: the room has moved on.
const TIMEOUT_MS = 3500;

export function buildBanterPrompt(agentName) {
  return `You are ${agentName}, a playful goose sous-chef in a live cook. The cooks are talking to each other, not to you. You overheard the lines below.

Most of the time, reply with an empty string. Only chime in when there is a joke, a tease or a light moment you can genuinely add to, the way a friend in the kitchen would.

Rules:
- One line, under 15 words, plain speech, no emoji. It is read aloud.
- Play along with what they said. Never give instructions, never mention steps, timers or progress.
- Never be mean about anyone, and never bring up anything private or serious they said.
- If they are arguing, stressed, or talking about something serious, reply with an empty string.
- If you are not sure it is funny, reply with an empty string.`;
}

export function buildBanterMessage(lines) {
  return (lines || []).map((l) => `${l.speaker || "Someone"}: ${l.text}`).join("\n");
}

/** @returns {Promise<{line: string}>} empty means say nothing. */
export async function requestBanter({ apiKey, model, agentName, lines, timeoutMs = TIMEOUT_MS }) {
  if (!lines?.length) return { line: "" };
  try {
    const choice = await chat({
      apiKey,
      model,
      maxTokens: MAX_TOKENS,
      timeoutMs,
      messages: [
        { role: "system", content: buildBanterPrompt(agentName) },
        { role: "user", content: buildBanterMessage(lines) },
      ],
    });
    const line = cleanAside(choice?.message?.content);
    // "Reply with an empty string" is sometimes taken literally: "".
    return { line: /^["'\s.]*$/.test(line) ? "" : line };
  } catch {
    return { line: "" };
  }
}
