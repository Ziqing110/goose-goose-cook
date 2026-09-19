import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { kitchenPickCommands } from "../utils/kitchenPick.js";
import "./SessionKitchenSetupPage.css";

// Reached only if the session's kitchen profile was deleted mid-session
// (the guard in App.jsx sends here only when other profiles still
// exist — otherwise it bounces straight to Home). Kitchen creation
// itself only happens on Home now.
export default function SessionKitchenSetupPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();

  const pickExisting = (id) => {
    dispatch({ type: "session/update", payload: { kitchenProfileId: id } });
    navigate("/session/conversation");
  };

  // Say a kitchen's name (or one word only it has) to pick it. A word two
  // kitchens share picks neither — the wrong kitchen means the wrong equipment.
  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: { hint: { line: "Say a kitchen's name to pick it.", sub: "This session's kitchen was removed." } },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);
  useEffect(
    () => registerVoiceCommands(kitchenPickCommands(state.kitchenProfiles, pickExisting, (p) => `Using ${p.name}.`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.kitchenProfiles]
  );

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
        <p className="hint">This session&rsquo;s kitchen was removed. Pick another one to continue.</p>
        <div className="existing-kitchens-list">
          {state.kitchenProfiles.map((p) => (
            <button type="button" key={p.id} className="btn" onClick={() => pickExisting(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
