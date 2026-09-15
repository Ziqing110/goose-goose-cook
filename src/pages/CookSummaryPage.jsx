// The card you get after a cook, and can come back to from Home.
//
// Lives outside /session/* on purpose: every session guard bounces to
// Home the moment the session is cleared, which happens the instant a
// cook is saved. So this reads a session by id from the API and never
// touches state.session.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSession, updateSession } from "../api/sessions.js";
import { stylePhoto } from "../api/photo.js";
import { formatDuration } from "../utils/graphLayout.js";
import { fileToDataUrl, applyLocalStyle, renderShareCard, downloadDataUrl } from "../utils/summaryCard.js";
import "./CookSummaryPage.css";

const RANK_MEDALS = ["1st", "2nd", "3rd"];

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CookSummaryPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    getSession(sessionId)
      .then((s) => {
        if (!live) return;
        setSession(s);
        setStatus("loaded");
      })
      .catch(() => live && setStatus("missing"));
    return () => {
      live = false;
    };
  }, [sessionId]);

  const summary = session?.summary || null;
  const cooks = useMemo(() => summary?.cooks || [], [summary]);

  const saveSummary = async (next) => {
    setSession((s) => ({ ...s, summary: next }));
    try {
      await updateSession(sessionId, { summary: next });
    } catch {
      setError("Saved locally, but couldn't reach the server.");
    }
  };

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("Reading photo…");
    try {
      const photo = await fileToDataUrl(file);
      setBusy("Styling…");
      let styledPhoto = photo;
      let photoSource = "stub";
      try {
        const result = await stylePhoto(photo, `A styled hero shot of ${summary.dish}`);
        photoSource = result.source;
        // The stub hands the original straight back, so do the visible
        // work locally rather than pretending nothing happened.
        styledPhoto = result.source === "model" ? result.dataUrl : await applyLocalStyle(result.dataUrl);
      } catch {
        styledPhoto = await applyLocalStyle(photo);
        setError("Styling service unavailable — used a local effect instead.");
      }
      await saveSummary({ ...summary, photo, styledPhoto, photoSource });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    setBusy("Building card…");
    try {
      downloadDataUrl(await renderShareCard(summary), `${(summary.dish || "cook").replace(/\W+/g, "-").toLowerCase()}.png`);
    } catch {
      setError("Couldn't build the card image.");
    } finally {
      setBusy(null);
    }
  };

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — you can copy the address bar instead.");
    }
  };

  if (status === "loading") return null; // avoids a flash-redirect on hard refresh

  if (status === "missing" || !summary) {
    return (
      <section className="page summary-page">
        <div className="band-header">
          <div className="band-header-left">
            <div>
              <p className="band-eyebrow">Kitchen Path</p>
              <h1>No card for this cook</h1>
            </div>
          </div>
        </div>
        <p className="hint">
          {status === "missing"
            ? "That cook doesn't exist any more."
            : "This session was left before anyone finished cooking, so there's no card to show."}
        </p>
        <button className="btn btn-primary" onClick={() => navigate("/")}>
          Back to Home
        </button>
      </section>
    );
  }

  const hero = summary.styledPhoto || summary.photo;

  return (
    <section className="page summary-page">
      <div className="band-header">
        <div className="band-header-left">
          <div>
            <p className="band-eyebrow">{formatDate(summary.createdAt)} &middot; {summary.mode}</p>
            <h1>{summary.dish}</h1>
          </div>
        </div>
        <div className="band-header-right">
          {/* A quick cook rounds to "0 min", which reads as broken. */}
          <span className="tag mono">
            {summary.totalSec < 60 ? `${Math.max(1, Math.round(summary.totalSec))}s` : `${Math.round(summary.totalSec / 60)} min`}
          </span>
          {summary.estimatedSec != null && (
            <span className="tag mono">
              {summary.totalSec <= summary.estimatedSec ? "under" : "over"} plan by{" "}
              {formatDuration(Math.abs(summary.totalSec - summary.estimatedSec))}
            </span>
          )}
        </div>
      </div>

      <p className="summary-headline">{summary.headline}</p>

      <div className="card summary-hero">
        {hero ? (
          <>
            <img className="summary-photo" src={hero} alt={summary.dish} />
            <div className="summary-hero-foot">
              <span className="hint">
                {summary.photoSource === "model" ? "Styled by the image model." : "Styled locally — no image model wired up yet."}
              </span>
              <label className="btn">
                Replace photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
              </label>
            </div>
          </>
        ) : (
          <label className="summary-dropzone">
            <span className="mini-title">Add a photo of the food</span>
            <p className="hint">We&rsquo;ll style it and put it on the card.</p>
            <span className="btn btn-primary btn-lg">Take or choose a photo</span>
            <input type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          </label>
        )}
      </div>

      {busy && <p className="hint">{busy}</p>}
      {error && <p className="hint summary-error">{error}</p>}

      <div className="scoreboard-grid">
        {cooks.map((cook) => (
          <div className={`card score-panel cook-border-${cook.colorKey} ${cook.isWinner ? "is-winner" : ""}`} key={cook.cookId}>
            <div className="score-head">
              <span className={`cook-avatar cook-avatar-sm cook-color-${cook.colorKey}`}>{cook.name[0]?.toUpperCase()}</span>
              <span className="score-name">{cook.name}</span>
              <span className="tag mono">{RANK_MEDALS[cook.rank - 1] || `${cook.rank}th`}</span>
            </div>
            <div className={`score-points mono ink-${cook.colorKey}`}>{cook.points}</div>
            <div className="hint mono score-sub">
              {cook.doneCount} done{cook.skippedCount ? ` · ${cook.skippedCount} skipped` : ""}
            </div>
            {cook.quips.map((q, i) => (
              <p className="score-quip" key={i}>
                {q}
              </p>
            ))}
          </div>
        ))}
      </div>

      <div className="card ledger">
        <span className="mini-title">Who did what</span>
        <div className="ledger-cols">
          {cooks.map((cook) => (
            <div className="ledger-col" key={cook.cookId}>
              <div className={`ledger-col-head cook-color-${cook.colorKey}`}>{cook.name}</div>
              {cook.steps.length === 0 ? (
                <p className="hint">Nothing completed.</p>
              ) : (
                <ul className="ledger-list">
                  {cook.steps.map((s, i) => (
                    <li key={i} className={s.status === "skipped" ? "is-skipped" : ""}>
                      <span className="ledger-label">{s.label}</span>
                      <span className="hint mono">
                        {s.status === "skipped"
                          ? "skipped"
                          : `${formatDuration(s.actualSec)}${s.deltaSec > 0 ? ` · +${formatDuration(s.deltaSec)}` : ""} · +${s.points}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="band-footer">
        <div className="band-footer-left">
          <button className="btn" onClick={onDownload} disabled={Boolean(busy)}>
            Download card
          </button>
          <button className="btn" onClick={onCopyLink}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
        <div className="band-footer-right">
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/")}>
            Back to Home
          </button>
        </div>
      </div>
    </section>
  );
}
