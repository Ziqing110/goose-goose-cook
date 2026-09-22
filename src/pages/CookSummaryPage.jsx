// Frozen journal for one completed cook. Outside /session/* by design.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getSession, updateSession } from "../api/sessions.js";
import { stylePhoto } from "../api/photo.js";
import { chefAvatar } from "../utils/cooks.js";
import { fileToDataUrl, applyLocalStyle, renderShareCard, downloadDataUrl } from "../utils/summaryCard.js";
import BabyGoose from "../components/BabyGoose.jsx";
import KpIcon from "../components/KpIcon.jsx";
import "./CookSummaryPage.css";

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}
function formatClock(sec) {
  const safe = Math.max(0, Math.round(Number(sec) || 0));
  if (safe < 60) return `${safe}s`;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
function formatTotal(sec) {
  const safe = Math.max(0, Math.round(Number(sec) || 0));
  return safe < 60 ? `${Math.max(1, safe)}s` : `${Math.round(safe / 60)} min`;
}
function formatPlan(totalSec, estimatedSec) {
  if (estimatedSec == null) return null;
  const planned = Math.max(1, Math.round(estimatedSec / 60));
  const delta = Math.max(1, Math.round(Math.abs(totalSec - estimatedSec) / 60));
  return `planned ${planned} min · ${delta} min ${totalSec <= estimatedSec ? "inside" : "over"}`;
}

function PlayerAvatar({ cook, sessionCook }) {
  const avatar = chefAvatar(sessionCook?.avatar);
  return <span className={`journal-avatar is-${cook.colorKey}`} style={{ "--avatar-bg": avatar.bg }}><img src={avatar.src} alt="" /></span>;
}

function PlayerColumn({ cook, sessionCook, versus, tied }) {
  return (
    <section className="journal-player">
      <header className="journal-player-head">
        <PlayerAvatar cook={cook} sessionCook={sessionCook} />
        <div className="journal-signature">
          <div className="journal-signature-line">
            <h2>{cook.name}</h2>
            {versus && <span className="journal-points mono">{cook.points} pts</span>}
            {versus && cook.isWinner && !tied && <KpIcon glyph="trophy" size={16} className="journal-winner" />}
          </div>
          <span className="journal-step-count mono">
            {cook.doneCount} {cook.doneCount === 1 ? "step" : "steps"}{cook.skippedCount > 0 ? ` · ${cook.skippedCount} skipped` : ""}
          </span>
        </div>
      </header>
      {cook.steps.length ? (
        <ul className="journal-steps">
          {cook.steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className={step.status === "skipped" ? "is-skipped" : ""}>
              <span className="journal-step-label">{step.label}</span>
              <span className="journal-step-meta mono">
                {step.status === "skipped" ? "skipped" : `${formatClock(step.actualSec)}${step.deltaSec > 0 ? ` · ${formatClock(step.deltaSec)} over` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="journal-empty">Nothing finished.</p>}
      {cook.quips?.length > 0 && <div className="journal-notes">{cook.quips.slice(0, 2).map((quip, index) => <p key={index}>{quip}</p>)}</div>}
    </section>
  );
}

export default function CookSummaryPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    getSession(sessionId).then((result) => {
      if (live) { setSession(result); setStatus("loaded"); }
    }).catch(() => live && setStatus("missing"));
    return () => { live = false; };
  }, [sessionId]);

  const summary = session?.summary || null;
  const cooks = useMemo(() => summary?.cooks || [], [summary]);
  const sessionCooks = useMemo(() => new Map((session?.cooks || []).map((cook) => [cook.id, cook])), [session]);

  const saveSummary = async (next) => {
    setSession((current) => ({ ...current, summary: next }));
    await updateSession(sessionId, { summary: next });
  };
  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const photo = await fileToDataUrl(file);
      setPendingPhoto(photo);
      setBusy("styling");
      try {
        const result = await stylePhoto(photo, `A styled hero shot of ${summary.dish}`);
        const styledPhoto = result.source === "model" ? result.dataUrl : await applyLocalStyle(result.dataUrl);
        await saveSummary({ ...summary, photo, styledPhoto, photoSource: result.source });
      } catch {
        await saveSummary({ ...summary, photo, styledPhoto: null, photoSource: null });
        setError("Styling didn't work — kept your photo as is.");
      }
    } catch (photoError) {
      setError(photoError.message || "Couldn't read that photo.");
    } finally {
      setBusy(null);
      setPendingPhoto(null);
    }
  };
  const onDownload = async () => {
    setBusy("saving");
    setError(null);
    try {
      downloadDataUrl(await renderShareCard(summary), `${(summary.dish || "cook").replace(/\W+/g, "-").toLowerCase()}.png`);
    } catch {
      setError("Couldn't build the image — try again.");
    } finally { setBusy(null); }
  };
  const onCopyLink = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setError("Couldn't copy — use the address bar."); }
  };

  if (status === "loading") return null;
  if (status === "missing" || !summary) {
    return (
      <section className="journal-missing">
        <span className="journal-eyebrow">Cook journal</span>
        <h1>No page for this cook</h1>
        <p>{status === "missing" ? "That cook doesn't exist any more." : "This cook was left before anyone finished, so there's nothing to write down."}</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>Back to Home</button>
      </section>
    );
  }

  const hero = pendingPhoto || summary.styledPhoto || summary.photo;
  const versus = summary.mode === "competition";
  const tied = versus && summary.winnerCookIds?.length > 1;
  const plan = !versus ? formatPlan(summary.totalSec, summary.estimatedSec) : null;

  return (
    <section className="cook-journal-page">
      <article className={`journal-sheet${location.state?.fromLiveCook ? " should-reveal" : ""}`}>
        <div className="journal-hero">
          {hero ? (
            <>
              <div className={`journal-photo-frame${busy === "styling" ? " is-styling" : ""}`}>
                <img src={hero} alt={summary.dish} />
                {busy === "styling" && <span className="journal-styling"><i aria-hidden="true" />Styling…</span>}
              </div>
              <div className="journal-photo-foot">
                <span>{summary.photoSource === "model" ? "Styled" : summary.photoSource === "stub" ? "Styled here — no image model yet" : ""}</span>
                <button type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()} disabled={busy === "styling"}>Change photo</button>
              </div>
            </>
          ) : (
            <div className="journal-no-photo">
              <div className="journal-no-photo-geese" aria-hidden="true"><BabyGoose pose="g1-on-it" size={78} decorative /><BabyGoose pose="g4-free-hands" size={78} decorative /></div>
              <p>Add the photo while it&apos;s still on the table.</p>
              <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>Add the photo</button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
        </div>

        <header className="journal-title-block">
          <span className="journal-eyebrow">Cook journal · <span className="mono">{formatDate(summary.createdAt)}</span></span>
          <h1>{summary.dish}</h1>
          <div className="journal-meta">
            <span className="mono">{formatTotal(summary.totalSec)}</span><span className="journal-dot">·</span>
            <span className="journal-mode-chip"><KpIcon glyph={versus ? "trophy" : "fork-branch"} size={16} />{versus ? "Versus" : "Co-op"}</span>
            {plan && <><span className="journal-dot">·</span><span className="mono journal-plan">{plan}</span></>}
          </div>
          <p className="journal-headline">{summary.headline}</p>
        </header>

        <section className="journal-kitchen">
          <span className="journal-section-label">In the kitchen</span>
          <div className="journal-players">
            {cooks.map((cook) => <PlayerColumn key={cook.cookId} cook={cook} sessionCook={sessionCooks.get(cook.cookId)} versus={versus} tied={tied} />)}
          </div>
        </section>

        {/* Same footer row as Home's list cards, so the sheet ends the
            way it began: as one card lifted out of the run log. */}
        <footer className="journal-actions">
          <div className="journal-actions-left">
            <button type="button" className="btn btn-ghost" onClick={onDownload} disabled={Boolean(busy)}>{busy === "saving" ? "Building…" : "Save the page"}</button>
            <button type="button" className="btn btn-ghost" onClick={onCopyLink}>{copied ? "Link copied" : "Copy link"}</button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>Back to Home</button>
        </footer>
      </article>
      {error && <p className="journal-error" role="status">{error}</p>}
    </section>
  );
}
