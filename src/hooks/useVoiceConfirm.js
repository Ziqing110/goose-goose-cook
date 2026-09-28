import { useEffect, useState } from "react";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { CONFIRM_YES_PATTERN, CONFIRM_NO_PATTERN } from "../utils/navCommands.js";

// Expires on its own so a stray "yes" a minute later can't be read as an
// answer to a question nobody remembers asking.
const CONFIRM_WINDOW_MS = 10_000;

/**
 * A page-local "did you mean X? Say yes or no." ask, for a voice command
 * whose best guess at a spoken name (matchStepName) came back close but
 * not exact. Same pattern InventoryPage's own board commands already use
 * for a guessed step reference — pulled out here so any panel that
 * resolves a spoken name against a list of candidates (a step, a
 * material) can ask the same way instead of either guessing silently or
 * flatly giving up on anything short of a word-for-word match.
 *
 * `ask(onYes, onNo?)` registers the answer at a higher priority than the
 * panel's own commands, so while it's pending only "yes"/"no" are heard
 * — the same shadowing a modal gets over the page underneath it.
 *
 * @returns {(onYes: () => void, onNo?: () => void) => void}
 */
export function useVoiceConfirm({ priority = 20 } = {}) {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!pending) return undefined;
    const unregister = registerVoiceCommands(
      [
        { phrases: [CONFIRM_YES_PATTERN], label: "Got it.", run: () => { setPending(null); pending.onYes(); } },
        { phrases: [CONFIRM_NO_PATTERN], label: "Okay.", run: () => { setPending(null); pending.onNo?.(); } },
      ],
      { priority, exclusive: true },
    );
    const timer = setTimeout(() => setPending(null), CONFIRM_WINDOW_MS);
    return () => {
      unregister();
      clearTimeout(timer);
    };
  }, [pending, priority]);

  return (onYes, onNo) => setPending({ onYes, onNo });
}
