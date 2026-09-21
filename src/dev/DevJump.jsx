// Dev-only shortcuts straight to a screen, skipping the wizard.
//
// The session flow needs a model call (conversation) and a real
// microphone (voice binding) before Schedule is even reachable, which
// makes the later screens slow to get to and impossible to hit without
// speaking. These routes seed a ready session through the API (the same
// seedSession the e2e uses) and land on the screen, so a test is one
// URL away:
//
//   /jump/schedule   Schedule, no mode picked yet
//   /jump/coop       Live cook, Co-op, run already started
//   /jump/versus     Live cook, Versus, run already started (no countdown)
//
// Seeding starts a fresh session, which abandons any run in progress —
// that is the API's invariant (see scripts/seed-session.mjs). Only
// mounted under `npm run dev`; App.jsx does not register the route in a
// production build.
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { seedSession } from "../../scripts/seed-session.mjs";
import * as sessionsApi from "../api/sessions.js";
import * as kitchensApi from "../api/kitchens.js";
import { useAppState } from "../state/AppStateContext.jsx";
import { mergeRecipesForDisplay, isFullyApproved } from "../utils/graphLayout.js";
import { areCooksBound } from "../utils/cooks.js";
import { computeSchedule, computeOpeningAssignment } from "../utils/scheduleLayout.js";
import { createRun } from "../utils/liveCook.js";

const TARGETS = {
  schedule: { mode: null, path: "/session/schedule" },
  coop: { mode: "cooperation", path: "/session/live-cook" },
  versus: { mode: "competition", path: "/session/live-cook" },
};

// Same run the Schedule page's "Go live" builds, from the same helpers,
// so the live cook it lands on is the one a click would have produced.
async function startRun(session, kitchens, mode) {
  const kitchenProfile = kitchens.find((k) => k.id === session.kitchenProfileId) || null;
  const nodes = mergeRecipesForDisplay(session.recipes, session.sharedSteps).approved?.nodes || [];
  const schedule = computeSchedule(nodes, session.cooks, kitchenProfile);
  const opening = computeOpeningAssignment(nodes, session.cooks, kitchenProfile);
  const run = createRun({ nodes, mode, schedule, opening, now: new Date() });
  await sessionsApi.updateSession(session.id, { mode, run });
}

// What App.jsx's route guards would bounce on, checked here so a
// failure says why instead of silently landing on Conversation.
function guardFailure(session, spec) {
  if (!session) return "no active session came back from the API";
  if (!session.conversation?.complete) return "conversation is not marked complete";
  if (!isFullyApproved(session.recipes, session.sharedSteps || [])) return "recipes are not approved";
  if (!areCooksBound(session.cooks || [])) return "cooks are not bound";
  if (spec.mode && session.mode !== spec.mode) return `mode is ${session.mode ?? "unset"}, wanted ${spec.mode}`;
  if (spec.mode && !session.run) return "run was not created";
  return null;
}

export default function DevJump() {
  const { target } = useParams();
  const navigate = useNavigate();
  const { refetchSessions } = useAppState();
  const [status, setStatus] = useState("Seeding a session…");
  const started = useRef(false);
  const spec = TARGETS[target];

  useEffect(() => {
    if (!spec || started.current) return; // StrictMode mounts twice; seed once
    started.current = true;
    (async () => {
      const { sessionId } = await seedSession("", { randomizeCooks: true, ensureUnattended: true });
      if (spec.mode) {
        setStatus("Starting the run…");
        const [session, kitchens] = await Promise.all([sessionsApi.getSession(sessionId), kitchensApi.listKitchens()]);
        await startRun(session, kitchens, spec.mode);
      }
      // Read back what the app will hydrate — the active session, not
      // the one just written — and refuse to jump if a guard would bounce.
      const [active] = await sessionsApi.listSessions(["active"]);
      const why = guardFailure(active?.id === sessionId ? active : null, spec);
      if (why) throw new Error(`seeded ${sessionId} but ${why}`);
      setStatus(`Loading ${spec.path}…`);
      // Re-hydrate in place rather than reload: AppStateProvider only
      // fetches on mount, and a full navigation would let the page being
      // left flush its own pending sync on the way out.
      await refetchSessions();
      navigate(spec.path, { replace: true });
    })().catch((err) => setStatus(`dev jump failed: ${err.message} (is the API up? npm run dev:full)`));
  }, [spec, navigate, refetchSessions]);

  if (!spec) return <Navigate to="/" replace />;
  return <p style={{ padding: "var(--space-6, 24px)", fontFamily: "monospace" }}>{status}</p>;
}
