// What the goose should know about the page it is on, in a few lines.
//
// Read only when nothing the page registered matched what somebody said
// and the goose is asked what they meant (see interpretationMenu). It is
// what makes "no, it's Zeina" a correction of the cook named Zina, and
// "we're out of the green stuff" land on scallions rather than nowhere.
//
// A layer with no commands of its own, at the priority of whatever it
// describes: a page at 0, a dialog above it. Registered once; the lines
// are read through a ref, so they are always the current render's.
import { useEffect, useRef } from "react";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";

/**
 * @param {string[]} lines  the page's state, one fact per line
 * @param {{priority?: number}} [options]  match the layer being described
 */
export function useVoicePageState(lines, { priority = 0 } = {}) {
  const ref = useRef(lines);
  ref.current = lines;
  useEffect(() => registerVoiceCommands([], { priority, describe: () => ref.current.filter(Boolean) }), [priority]);
}
