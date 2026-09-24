// Which session pages you may be on, as one pure function.
//
// Two places need this answer and they used to compute it separately.
// App's route guards bounce you off a page you aren't ready for, and the
// voice bar decides whether "go to the schedule" should move you or say
// "not yet". The voice bar read the progress chrome's stage flags, which
// count a stage done once anything after it is done — right for drawing
// the progress bar, wrong for guarding. Revise an approved board after
// binding cooks and the flags still called Schedule reachable, so voice
// navigated there and the guard bounced it straight back to Inventory:
// the exact "command looks like it failed" the check exists to prevent.
//
// Now both ask this function, so they cannot disagree.
import { isFullyApproved } from "./graphLayout.js";
import { areCooksBound } from "./cooks.js";

export const ROUTES = {
  home: "/",
  kitchenSetup: "/session/kitchen-setup",
  conversation: "/session/conversation",
  inventory: "/session/inventory",
  voiceBinding: "/session/voice-binding",
  schedule: "/session/schedule",
  liveCook: "/session/live-cook",
};

/**
 * Where the guards would send you instead of `path`, or null when you
 * may stay. Each requirement is checked in stage order and a page only
 * needs the ones before it.
 *
 * @param {string} path  one of ROUTES
 * @param {{ session: object|null, kitchenProfiles: object[] }} state
 */
export function guardRedirect(path, { session, kitchenProfiles = [] }) {
  if (path === ROUTES.home) return null;
  if (!session) return ROUTES.home;
  if (path === ROUTES.kitchenSetup) return null;
  // The session's kitchen was deleted. With nothing left to pick there
  // is no point in the picker, so it is Home instead of a dead end.
  if (!session.kitchenProfileId) {
    return kitchenProfiles.length === 0 ? ROUTES.home : ROUTES.kitchenSetup;
  }
  if (path === ROUTES.conversation) return null;
  if (!session.conversation?.complete) return ROUTES.conversation;
  if (path === ROUTES.inventory) return null;
  if (!isFullyApproved(session.recipes || [], session.sharedSteps || [])) return ROUTES.inventory;
  if (path === ROUTES.voiceBinding) return null;
  if (!areCooksBound(session.cooks || [])) return ROUTES.voiceBinding;
  if (path === ROUTES.schedule) return null;
  if (!session.mode) return ROUTES.schedule;
  return null;
}

/**
 * Pages voice navigation may take you to right now.
 *
 * The guards, plus two pages that let you in but have nothing for you:
 *
 * - Kitchen setup only exists to replace a deleted kitchen. With a
 *   kitchen in place it would tell you yours "was removed", which is
 *   not true.
 * - Live cook lets you in once a mode is picked, but until "Go live"
 *   creates the run it is an empty page pointing back at the plan.
 */
export function voiceReachablePaths(state) {
  const { session } = state;
  return Object.values(ROUTES).filter((path) => {
    if (guardRedirect(path, state) !== null) return false;
    if (path === ROUTES.kitchenSetup) return !session.kitchenProfileId;
    if (path === ROUTES.liveCook) return Boolean(session.run);
    return true;
  });
}
