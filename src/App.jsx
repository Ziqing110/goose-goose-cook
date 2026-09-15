import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell.jsx";
import HomePage from "./pages/HomePage.jsx";
import SessionLayout from "./pages/SessionLayout.jsx";
import SessionKitchenSetupPage from "./pages/SessionKitchenSetupPage.jsx";
import ConversationPage from "./pages/ConversationPage.jsx";
import RecipeGraphPage from "./pages/RecipeGraphPage.jsx";
import VoiceBindingPage from "./pages/VoiceBindingPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import LiveCookPage from "./pages/LiveCookPage.jsx";
import { useAppState } from "./state/AppStateContext.jsx";
import { isFullyApproved } from "./utils/graphLayout.js";
import { areCooksBound } from "./utils/cooks.js";

// Route guards: Home is always reachable (it's the entry point, not a
// wizard step). Everything under /session requires an in-progress
// session, and the two inner guards encode ordering within it —
// mirroring the old flat completion-flag guards, just scoped to the
// session object instead of global state.
//
// Kitchen setup only happens on Home now (you can't start a session
// without picking/adding a kitchen there), so `!kitchenProfileId` here
// is purely the edge case of the active profile being deleted mid-
// session. If no profiles exist at all in that case, there's nothing
// to pick — bounce all the way back to Home instead of a dead-end page.
function nextRequiredPath(state) {
  if (!state.session) return "/";
  if (!state.session.kitchenProfileId) {
    return state.kitchenProfiles.length === 0 ? "/" : "/session/kitchen-setup";
  }
  return null;
}

function RequireSession({ children }) {
  const { state } = useAppState();
  // Sessions are fetched from the server on load (no longer synchronously
  // available from localStorage) — don't bounce to Home on a hard refresh
  // just because the fetch hasn't resolved yet.
  if (state.sessionStatus === "idle" || state.sessionStatus === "loading") return null;
  if (!state.session) return <Navigate to="/" replace />;
  return children;
}

function RequireKitchenProfile({ children }) {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  return children;
}

function RequireConversationComplete({ children }) {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  if (!state.session.conversation.complete) return <Navigate to="/session/conversation" replace />;
  return children;
}

function RequireRecipeApproved({ children }) {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  if (!state.session.conversation.complete) return <Navigate to="/session/conversation" replace />;
  if (!isFullyApproved(state.session.recipes, state.session.sharedSteps)) return <Navigate to="/session/recipe-graph" replace />;
  return children;
}

function RequireCooksBound({ children }) {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  if (!state.session.conversation.complete) return <Navigate to="/session/conversation" replace />;
  if (!isFullyApproved(state.session.recipes, state.session.sharedSteps)) return <Navigate to="/session/recipe-graph" replace />;
  if (!areCooksBound(state.session.cooks)) return <Navigate to="/session/voice-binding" replace />;
  return children;
}

function RequireModeSelected({ children }) {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  if (!state.session.conversation.complete) return <Navigate to="/session/conversation" replace />;
  if (!isFullyApproved(state.session.recipes, state.session.sharedSteps)) return <Navigate to="/session/recipe-graph" replace />;
  if (!areCooksBound(state.session.cooks)) return <Navigate to="/session/voice-binding" replace />;
  if (!state.session.mode) return <Navigate to="/session/schedule" replace />;
  return children;
}

// Landing on /session directly (e.g. "Resume cooking") sends the user
// to wherever they actually left off.
function SessionIndexRedirect() {
  const { state } = useAppState();
  const redirect = nextRequiredPath(state);
  if (redirect) return <Navigate to={redirect} replace />;
  if (!state.session.conversation.complete) return <Navigate to="/session/conversation" replace />;
  if (!isFullyApproved(state.session.recipes, state.session.sharedSteps)) return <Navigate to="/session/recipe-graph" replace />;
  if (!areCooksBound(state.session.cooks)) return <Navigate to="/session/voice-binding" replace />;
  // Deliberately not checking endedAt — a finished run resumes to its
  // summary, which lives on the same page.
  if (state.session.run) return <Navigate to="/session/live-cook" replace />;
  return <Navigate to="/session/schedule" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />

        <Route
          path="/session"
          element={
            <RequireSession>
              <SessionLayout />
            </RequireSession>
          }
        >
          <Route index element={<SessionIndexRedirect />} />
          <Route path="kitchen-setup" element={<SessionKitchenSetupPage />} />
          <Route
            path="conversation"
            element={
              <RequireKitchenProfile>
                <ConversationPage />
              </RequireKitchenProfile>
            }
          />
          <Route
            path="recipe-graph"
            element={
              <RequireConversationComplete>
                <RecipeGraphPage />
              </RequireConversationComplete>
            }
          />
          <Route
            path="voice-binding"
            element={
              <RequireRecipeApproved>
                <VoiceBindingPage />
              </RequireRecipeApproved>
            }
          />
          <Route
            path="schedule"
            element={
              <RequireCooksBound>
                <SchedulePage />
              </RequireCooksBound>
            }
          />
          <Route
            path="live-cook"
            element={
              <RequireModeSelected>
                <LiveCookPage />
              </RequireModeSelected>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
