// Shared app state, React-context style.
//
// `kitchenProfiles` now lives in the backend SQLite database (see
// server/) — this context mirrors it in memory via the API client in
// src/api/kitchens.js and never persists it to localStorage itself.
// `session` (the in-progress run through the pipeline) and
// `sessionHistory` (denormalized past-session summaries) still persist
// to localStorage — there's no session/account backend yet, so that's
// still the only durability they have.
import { createContext, useContext, useEffect, useReducer } from "react";
import * as kitchensApi from "../api/kitchens.js";

const STORAGE_KEY = "kitchenPath.state.v2";

function emptySessionConversation() {
  return { complete: false, transcript: [], answers: {}, questionIndex: 0 };
}

function emptySessionGraph() {
  return { draft: null, working: null, approved: null, selectedNodeId: null };
}

function makeSession(id, kitchenProfileId) {
  return {
    id,
    kitchenProfileId: kitchenProfileId ?? null, // null => session still needs kitchen setup
    startedAt: new Date().toISOString(),
    conversation: emptySessionConversation(),
    graph: emptySessionGraph(),
  };
}

function sessionSummary(session, kitchenProfiles, status) {
  const kitchenProfile = kitchenProfiles.find((p) => p.id === session.kitchenProfileId) || null;
  return {
    id: session.id,
    dish: session.graph.working?.title || session.conversation.answers.dishIdea || null,
    servings: session.graph.working?.servings ?? null,
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
  sessionHistory: [],
  voice: { muted: false }, // shared mic state — VoiceBar and the conversation answer bar both read/write this
};

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const persisted = JSON.parse(raw);
    return { ...initialState, session: persisted.session ?? null, sessionHistory: persisted.sessionHistory ?? [] };
  } catch {
    return initialState;
  }
}

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

    case "session/start":
      return { ...state, session: makeSession(action.payload.id, action.payload.kitchenProfileId) };
    case "session/attachKitchenProfile":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, kitchenProfileId: action.payload.kitchenProfileId } };
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
        sessionHistory: [sessionSummary(state.session, state.kitchenProfiles, action.payload.status), ...state.sessionHistory],
      };

    case "session/conversation/update":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, conversation: { ...state.session.conversation, ...action.payload } } };
    case "session/conversation/reset":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, conversation: emptySessionConversation() } };

    case "session/graph/init":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          graph: { draft: action.payload, working: action.payload, approved: null, selectedNodeId: null },
        },
      };
    case "session/graph/update":
      if (!state.session) return state;
      return { ...state, session: { ...state.session, graph: { ...state.session.graph, ...action.payload } } };

    case "voice/setMuted":
      return { ...state, voice: { ...state.voice, muted: action.payload.muted } };

    default:
      return state;
  }
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  // Kitchens live in the backend now — hydrate the mirror once on mount.
  useEffect(() => {
    dispatch({ type: "kitchenProfiles/loading" });
    kitchensApi
      .listKitchens()
      .then((profiles) => dispatch({ type: "kitchenProfiles/hydrate", payload: { profiles } }))
      .catch((err) => dispatch({ type: "kitchenProfiles/error", payload: { error: err.message } }));
  }, []);

  // Session/session-history persistence is still localStorage-only —
  // kitchens are deliberately excluded (they're the backend's job now).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: state.session, sessionHistory: state.sessionHistory }));
    } catch {
      // localStorage unavailable (quota, private browsing) — persistence is best-effort.
    }
  }, [state.session, state.sessionHistory]);

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

  const value = { state, dispatch, addKitchenProfile, editKitchenProfile, removeKitchenProfile, refetchKitchens };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside <AppStateProvider>");
  return ctx;
}
