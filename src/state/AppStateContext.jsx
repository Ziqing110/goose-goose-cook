// Shared app state, React-context style.
//
// `kitchenProfiles` mirrors the backend (src/api/kitchens.js). `session`
// and `sessionHistory` now also live in the backend (src/api/sessions.js)
// instead of localStorage — a session owns an ordered list of recipe
// instances (`session.recipes`) rather than one embedded graph, which is
// what lets a session eventually hold more than one dish. The reducer
// stays synchronous/optimistic throughout: dispatches update local state
// immediately, and a debounced effect below quietly persists the
// session (+ its recipes) to the server in the background.
import { createContext, useContext, useEffect, useRef, useState, useReducer } from "react";
import * as kitchensApi from "../api/kitchens.js";
import * as sessionsApi from "../api/sessions.js";

function emptySessionConversation() {
  return { complete: false, transcript: [], answers: {}, questionIndex: 0 };
}

function makeSession(id, kitchenProfileId) {
  return {
    id,
    kitchenProfileId: kitchenProfileId ?? null, // null => session still needs kitchen setup
    status: "active",
    startedAt: new Date().toISOString(),
    endedAt: null,
    conversation: emptySessionConversation(),
    selectedNodeId: null,
    recipes: [],
    sharedSteps: [],
    cooks: [],
    unavailableMaterials: [], // materials the cook says they don't have
    mode: null,
    run: null, // set when cooking actually starts — see LiveCookPage
  };
}

function sessionSummary(session, kitchenProfiles, status, hasSummary = false) {
  const kitchenProfile = kitchenProfiles.find((p) => p.id === session.kitchenProfileId) || null;
  return {
    hasSummary, // abandoned runs froze no card — Home uses this to know
    id: session.id,
    dish: session.recipes.map((r) => r.working?.title).filter(Boolean).join(" + ") || session.conversation.answers.dishIdea || null,
    servings: session.recipes[0]?.working?.servings ?? null,
    kitchenProfileId: session.kitchenProfileId,
    kitchenProfileName: kitchenProfile?.name || null,
    startedAt: session.startedAt,
    endedAt: new Date().toISOString(),
    status,
  };
}

const initialState = {
  kitchenProfiles: [],
  kitchensStatus: "idle", // "idle" | "loading" | "loaded" | "error"
  kitchensError: null,
  session: null,
  sessionStatus: "idle", // "idle" | "loading" | "loaded" | "error"
  sessionError: null,
  sessionHistory: [],
  // Shared mic state — VoiceBar and the conversation answer bar both
  // read/write `muted`. `hint` is the page-provided announcer copy
  // ({ line, sub } or null) the VoiceBar shows instead of its default.
  voice: { muted: false, hint: null },
};

function reducer(state, action) {
  switch (action.type) {
    case "kitchenProfiles/loading":
      return { ...state, kitchensStatus: "loading", kitchensError: null };
    case "kitchenProfiles/hydrate":
      return { ...state, kitchenProfiles: action.payload.profiles, kitchensStatus: "loaded", kitchensError: null };
    case "kitchenProfiles/error":
      return { ...state, kitchensStatus: "error", kitchensError: action.payload.error };
    case "kitchenProfiles/create":
      return { ...state, kitchenProfiles: [...state.kitchenProfiles, action.payload.profile] };
    case "kitchenProfiles/update":
      return {
        ...state,
        kitchenProfiles: state.kitchenProfiles.map((p) => (p.id === action.payload.profile.id ? action.payload.profile : p)),
      };
    case "kitchenProfiles/delete":
      return {
        ...state,
        kitchenProfiles: state.kitchenProfiles.filter((p) => p.id !== action.payload.id),
        session:
          state.session && state.session.kitchenProfileId === action.payload.id
            ? { ...state.session, kitchenProfileId: null }
            : state.session,
      };

    case "session/loading":
      return { ...state, sessionStatus: "loading", sessionError: null };
    case "session/hydrate":
      return { ...state, session: action.payload.session, sessionStatus: "loaded", sessionError: null };
    case "session/error":
      return { ...state, sessionStatus: "error", sessionError: action.payload.error };
    case "sessionHistory/hydrate":
      return { ...state, sessionHistory: action.payload.history };

    case "session/start":
      return { ...state, session: makeSession(action.payload.id, action.payload.kitchenProfileId) };
    case "session/update":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, ...action.payload } };
    case "session/discard":
      if (!state.session) return state;
      return {
        ...state,
        session: null,
        sessionHistory: [sessionSummary(state.session, state.kitchenProfiles, "abandoned"), ...state.sessionHistory],
      };
    case "session/finish":
      if (!state.session) return state;
      return {
        ...state,
        session: null,
        sessionHistory: [
          sessionSummary(state.session, state.kitchenProfiles, action.payload.status, action.payload.hasSummary),
          ...state.sessionHistory,
        ],
      };
    case "sessionHistory/remove":
      return { ...state, sessionHistory: state.sessionHistory.filter((s) => s.id !== action.payload.id) };

    case "session/conversation/update":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, conversation: { ...state.session.conversation, ...action.payload } } };
    case "session/conversation/reset":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, conversation: emptySessionConversation() } };

    case "session/recipes/add":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, recipes: [...state.session.recipes, action.payload.recipe] } };
    case "session/recipes/updateOne":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          recipes: state.session.recipes.map((r) => (r.id === action.payload.recipeId ? { ...r, ...action.payload.patch } : r)),
        },
      };

    case "session/sharedSteps/add":
      if (!state.session) return state;
      return {
        ...state,
        session: { ...state.session, sharedSteps: [...state.session.sharedSteps, action.payload.sharedStep] },
      };
    case "session/sharedSteps/updateOne":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          sharedSteps: state.session.sharedSteps.map((s) =>
            s.id === action.payload.sharedStepId ? { ...s, ...action.payload.patch } : s
          ),
        },
      };
    // A shared step can be a dependency for steps across recipe
    // boundaries (unlike a plain per-recipe node, whose dependents all
    // live in that same recipe), so removing it has to scrub depends_on
    // from every recipe's working nodes and every other shared step's
    // working node, not just one — mirrors the server-side scrub in
    // server/routes/sessions.js's shared-step DELETE route.
    case "session/sharedSteps/delete": {
      if (!state.session) return state;
      const { sharedStepId } = action.payload;
      const scrub = (node) => ({ ...node, depends_on: (node.depends_on || []).filter((d) => d !== sharedStepId) });
      return {
        ...state,
        session: {
          ...state.session,
          sharedSteps: state.session.sharedSteps
            .filter((s) => s.id !== sharedStepId)
            .map((s) => ({ ...s, working: scrub(s.working) })),
          recipes: state.session.recipes.map((r) => ({
            ...r,
            working: { ...r.working, nodes: r.working.nodes.map(scrub) },
          })),
        },
      };
    }

    case "voice/setMuted":
      return { ...state, voice: { ...state.voice, muted: action.payload.muted } };
    case "voice/setHint":
      return { ...state, voice: { ...state.voice, hint: action.payload.hint } };

    default:
      return state;
  }
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [recipesSyncedIds, setRecipesSyncedIds] = useState(() => new Set());
  const [sharedStepsSyncedIds, setSharedStepsSyncedIds] = useState(() => new Set());
  const debounceRef = useRef(null);

  // Kitchens live in the backend — hydrate the mirror once on mount.
  useEffect(() => {
    dispatch({ type: "kitchenProfiles/loading" });
    kitchensApi
      .listKitchens()
      .then((profiles) => dispatch({ type: "kitchenProfiles/hydrate", payload: { profiles } }))
      .catch((err) => dispatch({ type: "kitchenProfiles/error", payload: { error: err.message } }));
  }, []);

  // Sessions live in the backend too — resume an in-progress one (if
  // any) and load history for Home's "recent sessions" list.
  useEffect(() => {
    dispatch({ type: "session/loading" });
    // The active session is needed in full; history only feeds a list,
    // so it uses the compact projection (no photos or transcripts).
    Promise.all([sessionsApi.listSessions(["active"]), sessionsApi.listSessionSummaries(["completed", "abandoned"])])
      .then(([activeSessions, history]) => {
        const active = activeSessions[0] || null;
        if (active) {
          setRecipesSyncedIds(new Set(active.recipes.map((r) => r.id)));
          setSharedStepsSyncedIds(new Set((active.sharedSteps || []).map((s) => s.id)));
        }
        dispatch({ type: "session/hydrate", payload: { session: active } });
        dispatch({ type: "sessionHistory/hydrate", payload: { history } });
      })
      .catch((err) => dispatch({ type: "session/error", payload: { error: err.message } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced background sync: whenever the session changes, quietly
  // PATCH its top-level fields and any already-created recipe instance
  // to the server. Brand-new recipes are created explicitly (see
  // addRecipeToSession below) — this effect only ever PATCHes, never
  // creates, so it never races a recipe's initial POST.
  useEffect(() => {
    if (!state.session) return;
    const session = state.session;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      sessionsApi
        .updateSession(session.id, {
          kitchenProfileId: session.kitchenProfileId,
          conversation: session.conversation,
          selectedNodeId: session.selectedNodeId,
          cooks: session.cooks,
          unavailableMaterials: session.unavailableMaterials || [],
          mode: session.mode,
          run: session.run,
        })
        .catch((err) => console.error("Failed to sync session:", err));

      session.recipes.forEach((recipe) => {
        if (!recipesSyncedIds.has(recipe.id)) return; // still being created — see addRecipeToSession
        sessionsApi
          .updateRecipeInstance(session.id, recipe.id, {
            working: recipe.working,
            approved: recipe.approved,
            custom_materials: recipe.custom_materials,
          })
          .catch((err) => console.error("Failed to sync recipe instance:", err));
      });

      (session.sharedSteps || []).forEach((step) => {
        if (!sharedStepsSyncedIds.has(step.id)) return; // still being created — see addSharedStepToSession
        sessionsApi
          .updateSharedStep(session.id, step.id, { working: step.working, approved: step.approved })
          .catch((err) => console.error("Failed to sync shared step:", err));
      });
    }, 600);
    return () => clearTimeout(debounceRef.current);
  }, [state.session, recipesSyncedIds, sharedStepsSyncedIds]);

  const refetchKitchens = () => {
    dispatch({ type: "kitchenProfiles/loading" });
    return kitchensApi
      .listKitchens()
      .then((profiles) => dispatch({ type: "kitchenProfiles/hydrate", payload: { profiles } }))
      .catch((err) => dispatch({ type: "kitchenProfiles/error", payload: { error: err.message } }));
  };

  const addKitchenProfile = async (draft) => {
    const profile = await kitchensApi.createKitchen(draft);
    dispatch({ type: "kitchenProfiles/create", payload: { profile } });
    return profile;
  };

  const editKitchenProfile = async (id, patch) => {
    const profile = await kitchensApi.updateKitchen(id, patch);
    dispatch({ type: "kitchenProfiles/update", payload: { profile } });
    return profile;
  };

  const removeKitchenProfile = async (id) => {
    await kitchensApi.deleteKitchen(id);
    dispatch({ type: "kitchenProfiles/delete", payload: { id } });
  };

  // Optimistic: dispatches locally immediately, persists in the
  // background. The id is client-generated so there's no need to wait
  // on the server before navigating.
  const startSession = (kitchenProfileId) => {
    const id = crypto.randomUUID();
    dispatch({ type: "session/start", payload: { id, kitchenProfileId } });
    setRecipesSyncedIds(new Set());
    setSharedStepsSyncedIds(new Set());
    sessionsApi.createSession({ id, kitchenProfileId }).catch((err) => console.error("Failed to persist new session:", err));
    return id;
  };

  const discardSession = () => {
    if (!state.session) return;
    const sessionId = state.session.id;
    dispatch({ type: "session/discard" });
    sessionsApi
      .updateSession(sessionId, { status: "abandoned", endedAt: new Date().toISOString() })
      .catch((err) => console.error("Failed to persist session discard:", err));
  };

  // Registers a brand-new recipe instance both locally and server-side
  // (explicitly, not via the debounced effect) so later PATCHes to it
  // never race its creation.
  const addRecipeToSession = async (recipe) => {
    if (!state.session) return;
    dispatch({ type: "session/recipes/add", payload: { recipe } });
    try {
      await sessionsApi.createRecipeInstance(state.session.id, {
        id: recipe.id,
        templateId: recipe.templateId,
        draft: recipe.draft,
        working: recipe.working,
        custom_materials: recipe.custom_materials,
      });
      setRecipesSyncedIds((prev) => new Set(prev).add(recipe.id));
    } catch (err) {
      console.error("Failed to persist new recipe instance:", err);
    }
  };

  // Registers a brand-new shared step both locally and server-side
  // (explicitly, not via the debounced effect) so later PATCHes to it
  // never race its creation — mirrors addRecipeToSession above.
  const addSharedStepToSession = async (sharedStep) => {
    if (!state.session) return;
    dispatch({ type: "session/sharedSteps/add", payload: { sharedStep } });
    try {
      await sessionsApi.createSharedStep(state.session.id, { id: sharedStep.id, draft: sharedStep.draft, working: sharedStep.working });
      setSharedStepsSyncedIds((prev) => new Set(prev).add(sharedStep.id));
    } catch (err) {
      console.error("Failed to persist new shared step:", err);
    }
  };

  const deleteSharedStepFromSession = async (sharedStepId) => {
    if (!state.session) return;
    dispatch({ type: "session/sharedSteps/delete", payload: { sharedStepId } });
    setSharedStepsSyncedIds((prev) => {
      const next = new Set(prev);
      next.delete(sharedStepId);
      return next;
    });
    try {
      await sessionsApi.deleteSharedStep(state.session.id, sharedStepId);
    } catch (err) {
      console.error("Failed to persist shared step delete:", err);
    }
  };

  // Mirrors discardSession. Without the PATCH the row stays `active`
  // with a null ended_at, so a finished cook comes back as the *active*
  // session on reload and never reaches history.
  //
  // Unlike the rest of the app this one persists *before* dispatching,
  // and the caller awaits it. Two reasons: the summary card is fetched
  // back by id immediately afterwards, so navigating before the write
  // lands renders the "no card for this cook" dead end for a cook that
  // saved fine; and the dispatch clears state.session, which unmounts
  // the live-cook page via the route guards — optimism here would strand
  // the user on Home with no way to retry a failed save.
  const finishSession = async (summary) => {
    if (!state.session) return;
    const sessionId = state.session.id;
    const endedAt = new Date().toISOString();
    await sessionsApi.updateSession(sessionId, { status: "completed", endedAt, summary });
    dispatch({ type: "session/finish", payload: { status: "completed", hasSummary: Boolean(summary) } });
  };

  const removeRunFromHistory = async (id) => {
    dispatch({ type: "sessionHistory/remove", payload: { id } });
    try {
      await sessionsApi.deleteSession(id);
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  };

  // Live-cook writes skip the 600ms debounce. A run action records
  // something that already happened in the physical world (the pot went
  // on), so losing it to a refresh costs more than a redundant PATCH —
  // the debounced effect will still fire its own, with the same data.
  const saveRunNow = (run) => {
    if (!state.session) return;
    const sessionId = state.session.id;
    dispatch({ type: "session/update", payload: { run } });
    sessionsApi.updateSession(sessionId, { run }).catch((err) => console.error("Failed to persist run:", err));
  };

  const value = {
    state,
    dispatch,
    saveRunNow,
    finishSession,
    removeRunFromHistory,
    addKitchenProfile,
    editKitchenProfile,
    removeKitchenProfile,
    refetchKitchens,
    startSession,
    discardSession,
    addRecipeToSession,
    addSharedStepToSession,
    deleteSharedStepFromSession,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}
