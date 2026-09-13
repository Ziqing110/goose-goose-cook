import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import "./HomePage.css";

function equipmentSummary(p) {
  const bits = [`${p.burners} burners`, `${p.cuttingBoards} boards`, `${p.pots} pots`];
  if (p.hasWok) bits.push("wok");
  if (p.hasOven) bits.push("oven");
  return bits.join(" · ");
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function HomePage() {
  const { state, dispatch, addKitchenProfile, editKitchenProfile, removeKitchenProfile, refetchKitchens } = useAppState();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modalProfile, setModalProfile] = useState(undefined); // undefined = closed, null = "add", object = "edit"
  const [startAfterAdd, setStartAfterAdd] = useState(false); // true when the modal was opened from "start cooking"
  const [modalError, setModalError] = useState(null);

  const hasSession = Boolean(state.session);
  const profiles = state.kitchenProfiles;
  const kitchensLoading = state.kitchensStatus === "idle" || state.kitchensStatus === "loading";
  const kitchensLoadError = state.kitchensStatus === "error" ? state.kitchensError : null;

  const startSession = (kitchenProfileId) => {
    dispatch({ type: "session/start", payload: { id: crypto.randomUUID(), kitchenProfileId } });
    setPickerOpen(false);
    navigate("/session");
  };

  // No kitchen profile exists -> nothing to cook with. Kitchen setup only
  // happens here on Home now, not as an inline session step.
  const handleStartClick = () => {
    if (profiles.length === 0) return openAddProfileModal(true);
    if (profiles.length === 1) return startSession(profiles[0].id);
    setPickerOpen(true);
  };

  const openAddProfileModal = (thenStart) => {
    setStartAfterAdd(thenStart);
    setModalError(null);
    setModalProfile(null);
  };

  const discardSession = () => {
    if (!window.confirm("Discard the current cooking session? This can't be undone.")) return;
    dispatch({ type: "session/discard" });
  };

  const saveProfile = async (draft) => {
    setModalError(null);
    try {
      if (draft.id) {
        const { id, ...patch } = draft;
        await editKitchenProfile(id, patch);
        setModalProfile(undefined);
      } else {
        const created = await addKitchenProfile(draft);
        setModalProfile(undefined);
        if (startAfterAdd) startSession(created.id);
      }
      setStartAfterAdd(false);
    } catch (err) {
      setModalError(err.message);
    }
  };

  const deleteProfile = async () => {
    if (!window.confirm(`Delete "${modalProfile.name}"?`)) return;
    try {
      await removeKitchenProfile(modalProfile.id);
      setModalProfile(undefined);
    } catch (err) {
      setModalError(err.message);
    }
  };

  return (
    <section className="page home-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">Kitchen Path Agent</p>
            <h1>What are we cooking?</h1>
          </div>
        </div>
      </div>

      <div className="card hero-card">
        {hasSession ? (
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-hero" onClick={() => navigate("/session")}>
              Resume cooking &rarr;
            </button>
            <button type="button" className="btn btn-ghost" onClick={discardSession}>
              Discard and start new
            </button>
          </div>
        ) : kitchensLoading ? (
          <p className="hint">Loading your kitchens&hellip;</p>
        ) : kitchensLoadError ? (
          <div className="hero-actions">
            <p className="hint">Couldn't reach the kitchen server: {kitchensLoadError}</p>
            <button type="button" className="btn" onClick={refetchKitchens}>
              Retry
            </button>
          </div>
        ) : pickerOpen ? (
          <div className="kitchen-picker">
            <span className="mini-title">Which kitchen?</span>
            <div className="kitchen-picker-list">
              {profiles.map((p) => (
                <button type="button" key={p.id} className="btn" onClick={() => startSession(p.id)}>
                  {p.name}
                </button>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => openAddProfileModal(true)}>
                + Add a new kitchen
              </button>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setPickerOpen(false)}>
              Cancel
            </button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="hero-actions">
            <p className="hint">Add a kitchen before you can start cooking.</p>
            <button type="button" className="btn btn-primary btn-hero" onClick={() => openAddProfileModal(true)}>
              + Add your first kitchen
            </button>
          </div>
        ) : (
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-hero" onClick={handleStartClick}>
              Start cooking &rarr;
            </button>
          </div>
        )}
      </div>

      <div className="card list-card">
        <div className="list-card-head">
          <span className="mini-title">Your kitchens</span>
          <button type="button" className="btn" onClick={() => openAddProfileModal(false)}>
            + Add kitchen
          </button>
        </div>
        {kitchensLoading ? (
          <p className="hint">Loading&hellip;</p>
        ) : kitchensLoadError ? (
          <p className="hint">Couldn't load kitchens.</p>
        ) : profiles.length === 0 ? (
          <p className="hint">No kitchens yet — add one to get started.</p>
        ) : (
          <ul className="entity-list">
            {profiles.map((p) => (
              <li className="entity-row" key={p.id}>
                <div className="entity-row-main">
                  <span className="entity-row-title">{p.name}</span>
                  <span className="tag mono">{equipmentSummary(p)}</span>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setModalProfile(p)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card list-card">
        <div className="list-card-head">
          <span className="mini-title">Recent sessions</span>
        </div>
        {state.sessionHistory.length === 0 ? (
          <p className="hint">Nothing here yet — your first session will show up after you finish or leave one.</p>
        ) : (
          <ul className="entity-list">
            {state.sessionHistory.map((s) => (
              <li className="entity-row" key={s.id}>
                <div className="entity-row-main">
                  <span className="entity-row-title">{s.dish || "Untitled cook"}</span>
                  <span className="hint">{formatDate(s.endedAt)}</span>
                </div>
                <span className={`tag ${s.status === "completed" ? "tag-difficulty-low" : ""}`}>{s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalProfile !== undefined && (
        <KitchenProfileFormModal
          profile={modalProfile}
          notice={startAfterAdd ? "A kitchen is required before you can start a cooking session." : null}
          error={modalError}
          onSave={saveProfile}
          onDelete={deleteProfile}
          onClose={() => {
            setModalProfile(undefined);
            setStartAfterAdd(false);
            setModalError(null);
          }}
        />
      )}
    </section>
  );
}
