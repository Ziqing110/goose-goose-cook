// The cook card (design: "Cook card v2") — the evening kept. Frozen
// journal for one completed cook; outside /session/* by design.
//
// Service done is the scoreboard; this page is the keepsake, so it
// doesn't repeat the result tickets. The header is every stage's header
// (eyebrow, underlined title, run facts, the goose's aside); under it,
// the evening on the left — the photo print and one ledger of how it
// went, with the goose's lines — and the record on the right: the
// receipt Service done tore off, pinned up whole.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getSession, updateSession } from "../api/sessions.js";
import { stylePhoto } from "../api/photo.js";
import { fileToDataUrl, applyLocalStyle, renderShareCard, downloadDataUrl } from "../utils/summaryCard.js";
import { clock, planDelta, resultPlayers, summaryOutcome } from "../utils/serviceResults.js";
import { PlayerAvatar, Stamp, StepReceipt } from "../components/ServiceResults.jsx";
import { GoosePrint } from "../components/GooseMarks.jsx";
import BabyGoose from "../components/BabyGoose.jsx";
import KpIcon from "../components/KpIcon.jsx";
import "./CookSummaryPage.css";

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

function TitleUnderline() {
  return (
    <svg className="ds-underline ds-underline-title" viewBox="0 0 430 10" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <path d="M2 7c68-4 144 1 220-2 58-2.5 134 3 206 .5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

// The print: the dish photo taped to the page, a hair of tilt, the date
// written on the white border beneath it. Empty, it waits with a dashed
// inner edge and two geese.
function Print({ hero, dish, date, styled, styling, onPick, canChange, children }) {
  return (
    <div className="cc-print-slot">
      <figure className="cc-print">
        <span className="cc-print-tape" aria-hidden="true" />
        <div className={`cc-print-photo ${hero ? "" : "is-empty"}`}>
          {hero ? (
            <>
              <img src={hero} alt={dish} className={styling ? "is-styling" : ""} />
              {styling && (
                <span className="cc-styling">
                  <i aria-hidden="true" />
                  Styling…
                </span>
              )}
            </>
          ) : (
            <div className="cc-print-empty">
              <div className="cc-print-geese" aria-hidden="true">
                <BabyGoose pose="g1-on-it" size={64} decorative />
                <BabyGoose pose="g4-free-hands" size={64} decorative />
              </div>
              <p>Add the photo while it&apos;s still on the table.</p>
              <button type="button" className="btn btn-primary" onClick={onPick}>Add the photo</button>
            </div>
          )}
        </div>
        <figcaption className="cc-print-caption">
          <span className="cc-print-date">{date}</span>
          {styled && <Stamp tone="honk">Styled</Stamp>}
        </figcaption>
      </figure>
      {canChange && (
        <button type="button" className="btn btn-ghost" onClick={onPick}>Change photo</button>
      )}
      {children}
    </div>
  );
}

// How it went, as one ledger: a row per player — avatar, name, the
// goose's stamp, their number — with the goose's lines about them under
// it. Versus counts points; Co-op counts steps, over the shared bar.
function ResultLedger({ players, versus, winnerCookIds }) {
  const tie = versus && winnerCookIds.length > 1;
  const anyWinner = winnerCookIds.length > 0;
  const stampFor = (p) => {
    if (!versus) return null;
    if (tie) return <Stamp tone={p.key}>Level</Stamp>;
    if (p.won) return <Stamp tone={p.key}>Winner</Stamp>;
    return anyWinner ? <Stamp tone={p.key}>Good game</Stamp> : null;
  };
  return (
    <div className={`cc-ledger ${versus ? "is-versus" : "is-coop"}`}>
      {!versus && (
        <div className="lc-share-bar" aria-hidden="true">
          {players.map((p) => (
            <span key={p.cook.id} className={`is-${p.key}`} style={{ flexGrow: p.entry.doneCount }} />
          ))}
        </div>
      )}
      {players.map((p) => (
        <div key={p.cook.id} className={`cc-ledger-row is-${p.key} ${versus && p.won && !tie ? "is-winner" : ""}`}>
          <div className="cc-ledger-head">
            <PlayerAvatar cook={p.cook} index={p.i} size={32} />
            <span className="cc-ledger-name">{p.cook.name}</span>
            {stampFor(p)}
            <span className="cc-ledger-num">
              {versus ? p.entry.points : p.entry.doneCount}
              <span className="cc-ledger-unit">{versus ? "pts" : p.entry.doneCount === 1 ? "step" : "steps"}</span>
            </span>
          </div>
          {p.quips.length > 0 && (
            <div className="cc-quips">
              {p.quips.map((line, n) => (
                <p key={n} className="cc-quip">
                  <GoosePrint size={13} />
                  <span>{line}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
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
  const outcome = useMemo(() => (summary ? summaryOutcome(summary) : null), [summary]);
  // Players in the session's own order, so "a" and "b" — and so each
  // player's colour — are the ones they cooked under. A summary whose
  // session lost its cooks falls back to the names it saved.
  const cooks = useMemo(() => {
    if (!summary) return [];
    const inSummary = new Set(summary.cooks.map((c) => c.cookId));
    const fromSession = (session?.cooks || []).filter((c) => inSummary.has(c.id));
    return fromSession.length ? fromSession : summary.cooks.map((c) => ({ id: c.cookId, name: c.name }));
  }, [session, summary]);
  const players = useMemo(() => {
    if (!outcome) return [];
    const quips = Object.fromEntries(summary.cooks.map((c) => [c.cookId, (c.quips || []).slice(0, 2)]));
    return resultPlayers({ outcome, cooks, dishOfStep: (s) => s.dish, quips });
  }, [outcome, cooks, summary]);

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
      <section className="page cook-card-page cc-missing">
        <div className="cc-missing-art" aria-hidden="true">
          <figure className="cc-print">
            <span className="cc-print-tape" />
            <div className="cc-print-photo is-empty" />
            <figcaption className="cc-print-caption" />
          </figure>
          <BabyGoose pose="g3-waiting" size={112} decorative />
        </div>
        <div className="cc-missing-copy">
          <h1>No page for this cook</h1>
          <p>{status === "missing" ? "This link doesn’t match a night in this kitchen." : "This cook was left before anyone finished, so there’s nothing to write down."}</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-key" onClick={() => navigate("/")}>Back to Home</button>
      </section>
    );
  }

  const hero = pendingPhoto || summary.styledPhoto || summary.photo;
  const versus = summary.mode === "competition";
  const date = formatDate(summary.createdAt);
  const { show: showDelta, deltaSec } = planDelta(outcome);
  const styling = busy === "styling";

  return (
    <section className={`page cook-card-page ${versus ? "is-versus" : "is-coop"}${location.state?.fromLiveCook ? " should-reveal" : ""}`}>
      <header className="cc-title-row">
        <span className="ds-run-eyebrow">Cook journal · {date}</span>
        <span className="ds-title-mark">
          <h1>{summary.dish}</h1>
          {/* The mark runs the width of its box, so a title that wraps
              would get a line past its last word — one-line titles only. */}
          {summary.dish.length <= 44 && <TitleUnderline />}
        </span>
        <p className="ds-run-facts">
          <span><span className="mono">{clock(summary.totalSec)}</span> on the clock</span>
          <span className="ds-mode-chip">
            <KpIcon glyph={versus ? "trophy" : "fork-branch"} size={14} />
            {versus ? "Versus" : "Co-op"}
          </span>
          {!versus && showDelta && (
            <span className={`cc-plan ${deltaSec <= 0 ? "is-under" : "is-over"}`}>
              <span className="mono">{clock(Math.abs(deltaSec))}</span> {deltaSec <= 0 ? "under plan" : "over plan"}
            </span>
          )}
        </p>
        {summary.headline && (
          <span className="ds-aside">
            <GoosePrint />
            <span>{summary.headline}</span>
          </span>
        )}
      </header>

      <div className="cc-body">
        <div className="cc-evening">
          <Print
            hero={hero}
            dish={summary.dish}
            date={date}
            styled={summary.photoSource === "model" && !pendingPhoto}
            styling={styling}
            canChange={Boolean(hero) && !styling}
            onPick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          </Print>
          <ResultLedger players={players} versus={versus} winnerCookIds={outcome.winnerCookIds} />
        </div>
        {/* As tall as the evening beside it, scrolling inside — the same
            way Service done holds it — so twenty steps never run the
            page on past the photo. */}
        <div className="cc-receipt-cell">
          <div className="lc-receipt-roll">
            <StepReceipt outcome={outcome} cooks={cooks} players={players} isVersus={versus} title={date} planMarks />
          </div>
        </div>
      </div>

      <footer className="cc-actions">
        <div className="cc-actions-left">
          <button type="button" className="btn btn-ghost" onClick={onDownload} disabled={Boolean(busy)}>{busy === "saving" ? "Building…" : "Save the page"}</button>
          <button type="button" className={`btn btn-ghost ${copied ? "is-copied" : ""}`} onClick={onCopyLink}>{copied ? "Link copied" : "Copy link"}</button>
        </div>
        <button type="button" className="btn btn-primary btn-lg btn-key" onClick={() => navigate("/")}>Back to Home</button>
      </footer>
      {error && <p className="cc-error" role="status">{error}</p>}
    </section>
  );
}
