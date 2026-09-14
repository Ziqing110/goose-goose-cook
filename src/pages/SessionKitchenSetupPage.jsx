import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import "./SessionKitchenSetupPage.css";

// Reached only if the session's kitchen profile was deleted mid-session
// (the guard in App.jsx sends here only when other profiles still
// exist — otherwise it bounces straight to Home). Kitchen creation
// itself only happens on Home now.
export default function SessionKitchenSetupPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();

  const useExisting = (id) => {
    dispatch({ type: "session/update", payload: { kitchenProfileId: id } });
    navigate("/session/conversation");
  };

  return (
    <section className="page session-kitchen-setup-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>Pick a kitchen</h1>
          </div>
        </div>
      </div>

      <div className="card existing-kitchens-card">
        <p className="hint">This session's kitchen was removed. Pick another one to continue.</p>
        <div className="existing-kitchens-list">
          {state.kitchenProfiles.map((p) => (
            <button type="button" key={p.id} className="btn" onClick={() => useExisting(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
