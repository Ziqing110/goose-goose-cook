import { useEffect } from "react";
import { playerLaneCssVars } from "../utils/playerColors.js";

/**
 * Writes the two swim lane slots' CSS custom properties
 * (--kp-cook-a/-b and friends) onto document.documentElement, from
 * the bird each cook picked. Root-level, not scoped to a page's own
 * subtree, so a portaled surface (the Schedule bottom sheet, which
 * mounts straight onto document.body) still inherits the right
 * colours. Callers that don't own the "current" cooks — like the
 * cook journal reading a specific past session by id — pass that
 * session's own cooks so they aren't overwritten by whichever
 * session happens to be active elsewhere in the app.
 *
 * Pass `null` (not `undefined`/`[]`) to skip writing entirely: for a
 * shared ancestor (AppShell) rendering a page that sets these for
 * itself, writing a fallback here too would race it — effects fire
 * child-first, so the ancestor's would win last and clobber the
 * page's real colours with the seat-default blue/orange.
 */
export function usePlayerLaneVars(cooks) {
  const skip = cooks === null;
  const avatarKey = skip ? "" : (cooks || []).map((c) => c.avatar || "").join(",");
  useEffect(() => {
    if (skip) return;
    const vars = playerLaneCssVars(cooks || []);
    const root = document.documentElement.style;
    Object.entries(vars).forEach(([name, value]) => root.setProperty(name, value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, avatarKey]);
}
