// Home v4 — "Tonight's run". A planning surface in the Kitchen Path
// Agent Design System (design/claude-design-home-*.md): the hero is
// the run card (states A–F below), then the kitchens loadout and the
// run log. Everything shown is derived from data the backend already
// returns — see src/utils/runStats.js for the derivations.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import KitchenProfileFormModal from "../components/KitchenProfileFormModal.jsx";
import KpIcon from "../components/KpIcon.jsx";
import welcomeBand from "../assets/home-welcome-band.png";
import {
  formatClock,
  formatShortDate,
  relativeTime,
  runFlames,
  runLogRecord,
  runPhaseCounts,
  runServings,
  runStages,
  runTitle,
  runTotalSeconds,
  summarizeRun,
} from "../utils/runStats.js";
import "./HomePage.css";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
// The same normalizer VoiceBar runs over the utterance before matching —
// kitchen names have to be folded exactly the same way or they will
// never line up.
import { normalizeUtterance } from "../utils/navCommands.js";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

function kitchenTagline(profile) {
  if (!profile) return "Two burners, one wok, one main line.";
  const burners = `${NUMBER_WORDS[profile.burners] || profile.burners} ${profile.burners === 1 ? "burner" : "burners"}`;
  return `${burners.charAt(0).toUpperCase()}${burners.slice(1)}${profile.hasWok ? ", one wok" : ""}, one main line.`;
}

/* ---------------- small presentational pieces ---------------- */

function Chip({ className = "", children, ...rest }) {
  return (
    <span className={`hp-chip ${className}`} {...rest}>
      {children}
    </span>
  );
}

function StatTile({ value, label, icon, delay }) {
  return (
    <div className="hp-stat">
      <span className="hp-stat-value-row">
        {icon && <KpIcon glyph={icon} size={20} />}
        <span className="hp-stat-value mono hp-roll" style={{ animationDelay: `${delay}ms` }}>
          {value}
        </span>
      </span>
      <span className="hp-stat-label">{label}</span>
    </div>
  );
}

// What the run is made of — not how far along it is. The phase colours
// are deliberately not the done/at-risk/blocked family, and the legend
// carries each phase's share so the bar doesn't have to be measured by
// eye.
function PhaseBar({ counts }) {
  const total = counts.prep + counts.cook + counts.plate;
  if (total === 0) return null;
  const phases = [
    { key: "prep", label: "prep", count: counts.prep },
    { key: "cook", label: "cook", count: counts.cook },
    { key: "plate", label: "plate", count: counts.plate },
  ];
  // Largest remainder, so the three shares always read as 100%.
  const exact = phases.map((p) => (p.count / total) * 100);
  const shares = exact.map(Math.floor);
  let left = 100 - shares.reduce((a, b) => a + b, 0);
  exact
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left > 0) {
        shares[i] += 1;
        left -= 1;
      }
    });
  return (
    <div className="hp-phase">
      <div
        className="hp-phase-bar"
        role="img"
        aria-label={phases.map((p, i) => `${p.count} ${p.label}, ${shares[i]}%`).join("; ")}
      >
        {phases.map((p, i) => (
          <span key={p.key} className={`hp-phase-seg is-${p.key}`} style={{ width: `${exact[i]}%` }} />
        ))}
      </div>
      <span className="hp-phase-legend mono">
        {phases.map((p, i) => (
          <span key={p.key} className={`hp-phase-key is-${p.key}`}>
            {p.count} {p.label} <span className="hp-phase-pct">{shares[i]}%</span>
          </span>
        ))}
      </span>
    </div>
  );
}

function StagePath({ stages }) {
  return (
    <ol className="hp-stages" aria-label="Run progress">
      {stages.map((stage, i) => (
        <li key={stage.id} className={`hp-stage is-${stage.state}`}>
          {i > 0 && <span className="hp-stage-link" aria-hidden="true" />}
          <span className="hp-stage-node" aria-hidden="true">
            {stage.state === "done" && <KpIcon glyph="checkmark-burst" size={16} />}
            {stage.state === "future" && <span className="hp-stage-dot" />}
          </span>
          <span className="hp-stage-label">
            <span>{stage.label}</span>
            {stage.count && <span className="mono hp-stage-count">{stage.count}</span>}
          </span>
          <span className="sr-only">
            {stage.state === "done" ? " — done" : stage.state === "current" ? " — in progress" : " — not started"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function LoadoutChips({ profile, delayBase = 0 }) {
  const items = [
    { glyph: "burner", value: profile.burners },
    { glyph: "cutting-board", value: profile.cuttingBoards },
    { glyph: "pot", value: profile.pots },
    profile.hasWok && { glyph: "wok", value: "Wok" },
    profile.hasOven && { glyph: "oven", value: "Oven" },
  ].filter(Boolean);
  return (
    <span className="hp-loadout">
      {items.map((it, i) => (
        <Chip key={it.glyph} className="hp-chip-equipment hp-pop" style={{ animationDelay: `${delayBase + i * 40}ms` }}>
          <KpIcon glyph={it.glyph} size={16} />
          {typeof it.value === "number" ? <span className="mono">{it.value}</span> : it.value}
        </Chip>
      ))}
    </span>
  );
}

/* ---------------- page ---------------- */

// What you have to say out loud to abandon a run by voice. Deliberately
// a whole sentence and deliberately specific: it names the thing being
// destroyed, so it cannot fall out of agreeing with something else. One
// constant, used by both the command and the on-screen copy, so the two
// can never drift apart and leave you reading a phrase that won't match.
const ABORT_PHRASE = "I want to abort this cooking session";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One command per kitchen on offer, matching what its button says.
 *
 * Kitchens are named by people, so the full name is the primary match —
 * "flat 3 galley" has to work as three words, not just its first. But
 * nobody says the whole name every time, so a single distinctive word
 * counts too, as long as it belongs to exactly one kitchen on the list.
 * Ambiguity is dropped rather than guessed: picking the wrong kitchen
 * starts a whole run against the wrong equipment.
 */
function kitchenPickCommands(profiles, start) {
  const norm = (s) => normalizeUtterance(s);

  // Words that identify exactly one kitchen. Anything shared between two
  // ("kitchen", "flat") identifies neither.
  const counts = new Map();
  profiles.forEach((p) => {
    new Set(norm(p.name).split(" ").filter((w) => w.length > 3)).forEach((w) => {
      counts.set(w, (counts.get(w) || 0) + 1);
    });
  });

  return profiles.map((p) => {
    const full = norm(p.name);
    const phrases = [new RegExp(`\\b${escapeRe(full)}\\b`)];
    norm(p.name)
      .split(" ")
      .filter((w) => w.length > 3 && counts.get(w) === 1)
      .forEach((w) => phrases.push(new RegExp(`\\b${escapeRe(w)}\\b`)));
    return {
      phrases,
      label: `Starting in ${p.name}.`,
      run: () => start(p.id),
    };
  });
}

export default function HomePage() {
  const {
    state,
    dispatch,
    addKitchenProfile,
    editKitchenProfile,
    removeKitchenProfile,
    refetchKitchens,
    refetchSessions,
    startSession,
    discardSession,
    removeRunFromHistory,
  } = useAppState();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modalProfile, setModalProfile] = useState(undefined); // undefined = closed, null = "add", object = "edit"
  const [startAfterAdd, setStartAfterAdd] = useState(false); // true when the modal was opened from "Start the run"
  const [modalError, setModalError] = useState(null);

  const session = state.session;
  const profiles = state.kitchenProfiles;
  const sessionLoading = state.sessionStatus === "idle" || state.sessionStatus === "loading";
  const kitchensLoading = state.kitchensStatus === "idle" || state.kitchensStatus === "loading";
  const kitchensLoadError = state.kitchensStatus === "error" ? state.kitchensError : null;
  const sessionLoadError = state.sessionStatus === "error" ? state.sessionError : null;

  const activeKitchen = session ? profiles.find((p) => p.id === session.kitchenProfileId) || null : null;
  const taglineKitchen = activeKitchen || (profiles.length === 1 ? profiles[0] : null);

  // Which hero state we're in, so the VoiceBar copy can follow it.
  const heroState = sessionLoading
    ? "loading"
    : sessionLoadError
      ? "sessionError"
      : session
      ? "resumable"
      : kitchensLoading
        ? "loading"
        : kitchensLoadError
          ? "error"
          : pickerOpen
            ? "picker"
            : profiles.length === 0
              ? "noKitchen"
              : "ready";

  const runLog = useMemo(() => {
    const rows = state.sessionHistory.map((item) => summarizeRun(item, profiles));
    return { rows, ...runLogRecord(rows) };
  }, [state.sessionHistory, profiles]);

  // VoiceBar as the announcer: one line + one AI line per hero state.
  useEffect(() => {
    let hint = null;
    if (heroState === "resumable") {
      const stages = runStages(session);
      const current = stages.find((s) => s.state === "current");
      // Kitchen picking isn't a stage anymore (see sessionSteps.js), but
      // a session can still lose its kitchen profile mid-run if it gets
      // deleted — check that directly rather than through the stage list.
      const sub =
        !session.kitchenProfileId
          ? "Pick a kitchen and I'll pick it up from there."
          : current?.id === "conversation"
            ? `You're ${current.count} into the conversation; I'll pick it up from there.`
            : "I'm your kitchen agent — we'll pick up right where you paused.";
      // Name all three things this page can do, not just the one it
      // wants most. Advertising only "resume the run" made the Add
      // kitchen and Abandon run buttons look unavailable while a run was
      // in progress — they are not, they sit right there on screen.
      hint = {
        line: "Say “resume the run”, “add a kitchen”, or “abandon the run”.",
        sub,
      };
    } else if (heroState === "picker") {
      // Name them, because the answer to "which kitchen?" is a word only
      // this cook knows. A bar offering generic commands while the screen
      // asks a specific question is the bar ignoring the question.
      hint = {
        line: "Say the kitchen's name to start there.",
        sub: profiles.map((p) => p.name).join(" · ") || null,
      };
    } else if (heroState === "ready") {
      hint = {
        line: "Say “start the run” or “add a kitchen”.",
        sub: profiles.length === 1 ? profiles[0].name : null,
      };
    } else if (heroState === "sessionError") {
      hint = { line: "I can't read the run log right now.", sub: "The kitchen server didn't answer — try again." };
    } else if (heroState === "noKitchen") {
      hint = {
        line: "Tell me about your kitchen and I'll build it.",
        sub: "Say “add a kitchen” to open the form.",
      };
    }
    dispatch({ type: "voice/setHint", payload: { hint } });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [heroState, session, profiles, dispatch]);

  // Register the commands the hint above advertises. Without this the
  // bar says "say 'resume the run'" and then ignores you when you do,
  // which is worse than a bar that promises nothing — the copy predates
  // the microphone being real.
  useEffect(() => {
    // The Add kitchen button is on screen in every hero state, so it is
    // a command in every hero state. Same rule as everywhere else: what
    // you can press, you can say.
    const addKitchen = {
      phrases: [/\badd (?:a |another )?kitchen\b/, /\bnew kitchen\b/],
      label: "Opening the kitchen form.",
      run: () => openAddProfileModal(false),
    };

    if (heroState === "resumable") {
      return registerVoiceCommands([
        {
          phrases: [/\bresume\b/, /\bcarry on with the run\b/],
          label: "Resuming.",
          run: () => navigate("/session"),
        },
        {
          // The only command here that destroys something: the run moves
          // to the log and cannot be resumed. Yes/no is not enough for
          // that — a stray "yeah" from the other side of the kitchen
          // would be sufficient, which is exactly the accident worth
          // ruling out. Reading the sentence back IS the authorisation.
          phrases: [/\b(?:abandon|abort|discard|cancel) (?:the |this )?(?:cooking )?(?:run|session|cook)\b/],
          confirmPhrase: ABORT_PHRASE,
          label: "Run abandoned.",
          run: discardSession,
        },
        addKitchen,
      ]);
    }
    if (heroState === "picker") {
      // The picker asks "Which kitchen?" and draws a button per kitchen,
      // and until now none of them could be said out loud — the one
      // question on this page that expects an answer had no voice answer.
      return registerVoiceCommands([
        ...kitchenPickCommands(profiles, handleStartSession),
        {
          phrases: [/\bcancel\b/, /\bnever ?mind\b/, /\bgo back\b/],
          label: "Cancelled.",
          run: () => setPickerOpen(false),
        },
        addKitchen,
      ]);
    }
    if (heroState === "ready") {
      return registerVoiceCommands([
        {
          // Only when there's no ambiguity about which kitchen. With
          // several profiles this opens a picker, and a voice command
          // that opens a dialog you then have to click is no better
          // than clicking the button.
          phrases: [/\bstart (?:the )?(?:run|cooking|session)\b/],
          label: profiles.length > 1 ? "Which kitchen?" : "Starting.",
          run: handleStartClick,
        },
        addKitchen,
      ]);
    }
    // Loading, error, no-kitchen: no run to act on, but you can still
    // add a kitchen, so that one stays registered.
    return registerVoiceCommands([addKitchen]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroState, profiles.length, navigate, session]);

  /* ---- actions ---- */

  const handleStartSession = (kitchenProfileId) => {
    startSession(kitchenProfileId);
    setPickerOpen(false);
    navigate("/session");
  };

  const openAddProfileModal = (thenStart) => {
    setStartAfterAdd(thenStart);
    setModalError(null);
    setModalProfile(null);
  };

  // No kitchen profile exists -> nothing to cook with. Kitchen setup only
  // happens here on Home, not as an inline session step.
  const handleStartClick = () => {
    if (profiles.length === 0) return openAddProfileModal(true);
    if (profiles.length === 1) return handleStartSession(profiles[0].id);
    setPickerOpen(true);
  };

  const handleDeleteRun = (row) => {
    if (!window.confirm(`Delete "${row.title}" from your run log? This can't be undone.`)) return;
    removeRunFromHistory(row.id);
  };

  const handleAbandon = () => {
    if (!window.confirm("Abandon this run? It moves to your run log and can't be resumed.")) return;
    discardSession();
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
        if (startAfterAdd) handleStartSession(created.id);
      }
      setStartAfterAdd(false);
    } catch (err) {
      setModalError(err.message);
    }
  };

  const deleteProfile = async () => {
    // Past runs only hold the kitchen's id, so deleting it leaves them
    // without a kitchen name in the run log. Small, but say so rather
    // than let the rows quietly change under them. (A run in progress is
    // a harder block — the server refuses that outright.)
    const pastRuns = state.sessionHistory.filter((s) => s.kitchenProfileId === modalProfile.id).length;
    const note = pastRuns > 0 ? ` ${pastRuns} past ${pastRuns === 1 ? "run" : "runs"} will lose its kitchen name.` : "";
    if (!window.confirm(`Delete "${modalProfile.name}"?${note}`)) return;
    try {
      await removeKitchenProfile(modalProfile.id);
      setModalProfile(undefined);
    } catch (err) {
      setModalError(err.message);
    }
  };

  /* ---- hero ---- */

  const renderHero = () => {
    switch (heroState) {
      case "loading":
        return (
          <div className="hp-hero-state hp-hero-loading" aria-live="polite" aria-label="Loading">
            <span className="mono hp-dots">…</span>
          </div>
        );

      case "error":
        return (
          <div className="hp-hero-state">
            <div className="hp-error-block">Couldn&rsquo;t reach the kitchen server: {kitchensLoadError}</div>
            <button type="button" className="hp-btn hp-btn-secondary" onClick={refetchKitchens}>
              Retry
            </button>
          </div>
        );

      // Deliberately offers no way to start a run: a failed fetch says
      // nothing about whether a run is already in progress, and starting
      // one closes out any other active session server-side. Retrying is
      // the only safe move.
      case "sessionError":
        return (
          <div className="hp-hero-state">
            <div className="hp-error-block">
              Couldn&rsquo;t load your runs: {sessionLoadError}. If a cook is already in progress it&rsquo;s still
              safe — this is just the reading of it.
            </div>
            <button type="button" className="hp-btn hp-btn-secondary" onClick={refetchSessions}>
              Retry
            </button>
          </div>
        );

      case "picker":
        return (
          <div className="hp-hero-state">
            <span className="hp-section-title">Which kitchen?</span>
            <div className="hp-btn-row">
              {profiles.map((p) => (
                <button type="button" key={p.id} className="hp-btn hp-btn-secondary" onClick={() => handleStartSession(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="hp-btn-row">
              <button type="button" className="hp-btn hp-btn-ghost hp-btn-ghost-accent" onClick={() => openAddProfileModal(true)}>
                Add a new kitchen
              </button>
              <button type="button" className="hp-btn hp-btn-ghost" onClick={() => setPickerOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        );

      case "noKitchen":
        return (
          <div className="hp-hero-state hp-hero-centered">
            <KpIcon glyph="burner" size={32} className="hp-empty-glyph" />
            <span className="hp-meta">A run needs a kitchen first.</span>
            <button type="button" className="hp-btn hp-btn-primary hp-btn-lg" onClick={() => openAddProfileModal(true)}>
              Add your first kitchen
            </button>
          </div>
        );

      case "ready":
        return (
          <div className="hp-hero-state">
            {profiles.length === 1 && <span className="hp-meta">Cooking in {profiles[0].name}</span>}
            <button type="button" className="hp-btn hp-btn-primary hp-btn-lg" onClick={handleStartClick}>
              Start the run
            </button>
          </div>
        );

      case "resumable":
      default:
        return renderRunCard();
    }
  };

  const renderRunCard = () => {
    const flames = runFlames(session);
    const hasSteps = (session.recipes || []).length > 0 || (session.sharedSteps || []).length > 0;
    const totalSec = runTotalSeconds(session);
    const steps = session.recipes.reduce((n, r) => n + (r.working?.nodes?.length || 0), 0) + (session.sharedSteps || []).length;
    const servings = runServings(session);
    const stages = runStages(session);

    return (
      <div className="hp-run">
        <div className="hp-run-body">
          <div className="hp-run-title-row">
            <span className="hp-section-title">{runTitle(session)}</span>
            {flames > 0 && (
              <Chip className="hp-chip-difficulty hp-pop" style={{ animationDelay: "200ms" }} aria-label={`Difficulty ${flames} of 3`}>
                {Array.from({ length: flames }, (_, i) => (
                  <KpIcon key={i} glyph="flame" size={16} />
                ))}
              </Chip>
            )}
          </div>

          <span className="hp-meta">
            {activeKitchen ? activeKitchen.name : "No kitchen"} · started {relativeTime(session.startedAt)}
          </span>

          {hasSteps && (
            <>
              <div className="hp-stats">
                <StatTile value={formatClock(totalSec)} label="total time" icon="timer" delay={320} />
                <StatTile value={steps} label="steps" delay={380} />
                {servings != null && <StatTile value={servings} label="servings" delay={440} />}
              </div>
              <PhaseBar counts={runPhaseCounts(session)} />
            </>
          )}

          <StagePath stages={stages} />
        </div>

        <div className="hp-run-actions">
          <button type="button" className="hp-btn hp-btn-primary hp-btn-lg" onClick={() => navigate("/session")}>
            Resume the run
          </button>
          <button type="button" className="hp-btn hp-btn-ghost hp-btn-abandon" onClick={handleAbandon}>
            Abandon run
          </button>
        </div>
      </div>
    );
  };

  /* ---- render ---- */

  return (
    <section className="home-v4">
      <header className="hp-title-row hp-reveal">
        <div className="hp-title-text">
          <h1>Tonight&rsquo;s run</h1>
          <span className="hp-sub">{kitchenTagline(taglineKitchen)}</span>
        </div>
        <img src={welcomeBand} alt="" aria-hidden="true" className="hp-band" />
      </header>

      <div className="hp-hero hp-reveal" style={{ animationDelay: "80ms" }}>
        {renderHero()}
      </div>

      <section className="hp-card hp-reveal" style={{ animationDelay: "160ms" }} aria-labelledby="hp-kitchens-title">
        <div className="hp-card-head">
          <span id="hp-kitchens-title" className="hp-section-title">
            Your kitchens
          </span>
          <button type="button" className="hp-btn hp-btn-secondary" onClick={() => openAddProfileModal(false)}>
            Add kitchen
          </button>
        </div>
        {kitchensLoading ? (
          <div className="hp-row hp-row-empty">
            <span className="mono hp-dots">…</span>
          </div>
        ) : kitchensLoadError ? (
          <div className="hp-row hp-row-empty">
            <span className="hp-meta">Couldn&rsquo;t load kitchens.</span>
          </div>
        ) : profiles.length === 0 ? (
          <div className="hp-row hp-row-empty">
            <span className="hp-meta">No kitchens yet — add one to start a run.</span>
          </div>
        ) : (
          <ul className="hp-list">
            {profiles.map((p, i) => {
              const inPlay = session?.kitchenProfileId === p.id;
              return (
                <li className="hp-row hp-row-kitchen" key={p.id}>
                  <KpIcon glyph="burner" size={24} className="hp-row-lead" />
                  <span className="hp-row-main">
                    <span className="hp-row-title-line">
                      <span className="hp-row-title">{p.name}</span>
                      {inPlay && <Chip className="hp-chip-status hp-chip-inplay">In play</Chip>}
                    </span>
                    <LoadoutChips profile={p} delayBase={200 + i * 60} />
                  </span>
                  <button type="button" className="hp-btn hp-btn-ghost hp-btn-ghost-accent" onClick={() => setModalProfile(p)}>
                    Edit
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="hp-card hp-reveal" style={{ animationDelay: "240ms" }} aria-labelledby="hp-runs-title">
        <div className="hp-card-head">
          <span id="hp-runs-title" className="hp-section-title">
            Recent runs
          </span>
          {runLog.rows.length > 0 && <span className="mono hp-record">{runLog.line}</span>}
        </div>
        {runLog.rows.length === 0 ? (
          <div className="hp-row hp-row-empty hp-row-empty-stack">
            <KpIcon glyph="trophy" size={32} className="hp-empty-glyph" />
            <span className="hp-meta">Your first run shows up here.</span>
          </div>
        ) : (
          <ol className="hp-list">
            {runLog.rows.map((r, i) => {
              const isBest = r.status === "completed" && runLog.bestSec != null && r.durationSec === runLog.bestSec;
              const metaBits = [
                r.kitchenName,
                r.servings != null ? (
                  <>
                    <span className="mono">{r.servings}</span> servings
                  </>
                ) : null,
                r.endedAt ? <span className="mono">{formatShortDate(r.endedAt)}</span> : null,
              ].filter(Boolean);
              return (
                <li
                  className={`hp-row hp-row-run hp-reveal${r.hasCard ? "" : " has-no-card"}`}
                  style={{ animationDelay: `${300 + i * 60}ms` }}
                  key={r.id}
                >
                  {/* Overlay rather than wrapping the row, so the layout
                      above stays exactly as designed. Only runs that
                      finished have a card to open — an abandoned one
                      would land on a dead end, so it isn't clickable. */}
                  {r.hasCard && (
                    <button
                      type="button"
                      className="hp-row-open"
                      onClick={() => navigate(`/cook/${r.id}`)}
                      aria-label={`Open the summary card for ${r.title}`}
                    />
                  )}
                  <span className="mono hp-rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="hp-row-main">
                    <span className="hp-row-title-line">
                      <span className="hp-row-title">{r.title}</span>
                      {isBest && <KpIcon glyph="trophy" size={20} className="hp-trophy" aria-label="Fastest run" />}
                    </span>
                    <span className="hp-meta">
                      {metaBits.map((bit, j) => (
                        <span key={j}>
                          {j > 0 && " · "}
                          {bit}
                        </span>
                      ))}
                    </span>
                  </span>
                  {r.durationSec != null && (
                    <span className={`mono hp-duration ${r.status === "completed" ? "" : "is-muted"}`}>{formatClock(r.durationSec)}</span>
                  )}
                  {r.status === "completed" ? (
                    <Chip className="hp-chip-status hp-chip-done hp-pop" style={{ animationDelay: `${360 + i * 60}ms` }}>
                      <KpIcon glyph="checkmark-burst" size={16} />
                      <span className="hp-chip-text">Done</span>
                    </Chip>
                  ) : (
                    <Chip className="hp-chip-status hp-chip-waiting">
                      <span className="hp-dot" />
                      <span className="hp-chip-text">Abandoned</span>
                    </Chip>
                  )}
                  {/* Sits above the row-open overlay so it stays clickable. */}
                  <button
                    type="button"
                    className="hp-row-delete"
                    onClick={() => handleDeleteRun(r)}
                    aria-label={`Delete the run ${r.title}`}
                    title="Delete this run"
                  >
                    &times;
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {modalProfile !== undefined && (
        <KitchenProfileFormModal
          profile={modalProfile}
          notice={startAfterAdd ? "A run needs a kitchen first." : null}
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
