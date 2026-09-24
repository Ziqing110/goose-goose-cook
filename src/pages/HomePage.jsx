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
import welcomeBand from "../assets/home-welcome-band-trim.webp";
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
import StagePath from "../components/StagePath.jsx";
import "./HomePage.css";
import { registerVoiceCommands } from "../utils/voicePageCommands.js";
import { HOME_VOICE } from "../utils/pageVoiceGrammar.js";
// The same normalizer VoiceBar runs over the utterance before matching —
// kitchen names have to be folded exactly the same way or they will
// never line up.
import { kitchenPickCommands } from "../utils/kitchenPick.js";

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

// A stable pseudo-random from a string, so a row's footprints stay put
// across renders rather than jittering every re-mount.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function seededRand(seed, index) {
  const x = Math.sin(seed + index * 9301) * 43758.5453;
  return x - Math.floor(x);
}
// Two footprints walking out of an abandoned row. Each row gets its own
// gait — angle, x-offset, y-offset — seeded from its id so it never
// reads as a repeated stamp down the list.
function Footprints({ seed }) {
  const h = hashSeed(String(seed));
  const r1 = seededRand(h, 0);
  const r2 = seededRand(h, 1);
  const r3 = seededRand(h, 2);
  const r4 = seededRand(h, 3);
  const r5 = seededRand(h, 4);
  const r6 = seededRand(h, 5);
  const r7 = seededRand(h, 6);
  // rot1 in [-115, -80], rot2 in [-95, -60]. left/bottom vary a few px.
  const rot1 = -115 + r1 * 35;
  const rot2 = -95 + r2 * 35;
  const left1 = 2 + r3 * 6;
  const left2 = 28 + r4 * 8;
  const bot1 = 2 + r5 * 8;
  const bot2 = 12 + r6 * 12;
  // Shift the whole pair sideways row-to-row so the marks don't line up
  // in a single column down the list — a real trail wanders across.
  const shift = -8 + r7 * 40;
  return (
    <span className="hp-footprints" aria-hidden="true" style={{ transform: `translateX(${shift}px)` }}>
      <svg viewBox="0 0 26 28" width="16" height="17" fill="none" className="hp-footprint" style={{ left: `${left1}px`, bottom: `${bot1}px`, transform: `rotate(${rot1}deg)` }}>
        <path d="M13 3.2c1.6 0 2.2 1.6 2.4 3.4l.5 4.6c.1 1.2 1 1.6 2 1.1l3.6-1.8c1.6-.8 2.8.6 1.7 2L14.9 25c-1 1.3-2.6 1.3-3.5 0L2.9 12.6c-1-1.4.2-2.8 1.8-2l3.5 1.8c1 .5 1.9.1 2-1.1l.5-4.6C10.9 4.8 11.4 3.2 13 3.2Z" fill="var(--kp-footprint-fill, #fdeada)" stroke="var(--kp-footprint-ink, #d2b79c)" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 26 28" width="19" height="20" fill="none" className="hp-footprint" style={{ left: `${left2}px`, bottom: `${bot2}px`, transform: `rotate(${rot2}deg)` }}>
        <path d="M13 3.2c1.6 0 2.2 1.6 2.4 3.4l.5 4.6c.1 1.2 1 1.6 2 1.1l3.6-1.8c1.6-.8 2.8.6 1.7 2L14.9 25c-1 1.3-2.6 1.3-3.5 0L2.9 12.6c-1-1.4.2-2.8 1.8-2l3.5 1.8c1 .5 1.9.1 2-1.1l.5-4.6C10.9 4.8 11.4 3.2 13 3.2Z" fill="var(--kp-footprint-fill-2, #f6cfa6)" stroke="var(--kp-footprint-ink-2, #b08a63)" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    </span>
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
      {items.map((it, i) => {
        const isCount = typeof it.value === "number";
        return (
          <Chip
            key={it.glyph}
            className={`hp-chip-equipment hp-pop${isCount ? " hp-chip-count" : ""}`}
            style={{ animationDelay: `${delayBase + i * 40}ms` }}
          >
            <KpIcon glyph={it.glyph} size={16} />
            {isCount ? <span className="mono hp-chip-num">{it.value}</span> : it.value}
          </Chip>
        );
      })}
    </span>
  );
}

/* ---------------- page ---------------- */

// The exact abort passphrase lives with this page's tested voice grammar.
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
      phrases: HOME_VOICE.addKitchen,
      label: "Opening the kitchen form.",
      run: () => openAddProfileModal(false),
    };

    if (heroState === "resumable") {
      return registerVoiceCommands([
        {
          phrases: HOME_VOICE.resume,
          label: "Resuming.",
          run: () => navigate("/session"),
        },
        {
          // The only command here that destroys something: the run moves
          // to the log and cannot be resumed. Yes/no is not enough for
          // that — a stray "yeah" from the other side of the kitchen
          // would be sufficient, which is exactly the accident worth
          // ruling out. Reading the sentence back IS the authorisation.
          phrases: HOME_VOICE.abandon,
          confirmPhrase: HOME_VOICE.abandonConfirmation,
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
          phrases: HOME_VOICE.cancelPicker,
          label: "Cancelled.",
          run: () => setPickerOpen(false),
        },
        addKitchen,
      ]);
    }
    if (heroState === "ready") {
      // Hitting Enter kicks off the run, matching the "↵ or hit enter"
      // hint next to the CTA. Ignored while the user is typing in a
      // control so the modal form and voice input aren't disturbed.
      const onKey = (e) => {
        if (e.key !== "Enter") return;
        const t = e.target;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
        e.preventDefault();
        handleStartClick();
      };
      window.addEventListener("keydown", onKey);
      const cleanupVoice = registerVoiceCommands([
        {
          // Only when there's no ambiguity about which kitchen. With
          // several profiles this opens a picker, and a voice command
          // that opens a dialog you then have to click is no better
          // than clicking the button.
          phrases: HOME_VOICE.start,
          label: profiles.length > 1 ? "Which kitchen?" : "Starting.",
          run: handleStartClick,
        },
        addKitchen,
      ]);
      return () => {
        window.removeEventListener("keydown", onKey);
        cleanupVoice();
      };
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
            <span className="hp-section-title hp-title-mark">
              Which kitchen?
              <svg
                className="hp-underline hp-underline-section"
                viewBox="0 0 120 8"
                preserveAspectRatio="none"
                aria-hidden="true"
                fill="none"
              >
                <path
                  d="M2 5c22-2.4 44 1.4 66-.8 16-1.6 36 1.8 50 .4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              </svg>
            </span>
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
            <div className="hp-start-row">
              {/* Weighted-key CTA (3a): a real bottom edge that presses
                  in on click. Enter is bound in the ready-state effect
                  below so the hint isn't a lie. */}
              <button type="button" className="hp-btn hp-btn-primary hp-btn-lg hp-btn-start-key" onClick={handleStartClick}>
                Start the run
              </button>
              <span className="hp-start-hint">
                <kbd className="hp-kbd">↵</kbd>
                <span className="mono">or hit enter</span>
              </span>
            </div>
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
      <div className="hp-run hp-run-tilt">
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

          <StagePath
            label="Run progress"
            stages={stages.map((stage) => ({
              key: stage.id,
              label: stage.label,
              // Home calls the stages it hasn't reached "future"; the
              // shared path calls them "waiting".
              state: stage.state === "future" ? "waiting" : stage.state,
            }))}
          />
        </div>

        <div className="hp-run-actions">
          <span className="hp-stamp-wrap">
            <button type="button" className="hp-btn hp-btn-primary hp-btn-lg hp-btn-start-key" onClick={() => navigate("/session")}>
              Resume the run
            </button>
            {/* HONK-style stamp — same voice as the Conversation page's
                pill: mono, tilted, orange, one signal that the run is
                still warm underneath. */}
            <span className="hp-stamp" aria-hidden="true">IN PROGRESS</span>
          </span>
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
          <span className="hp-title-mark">
            <h1>Tonight&rsquo;s run</h1>
            {/* Crooked hand-drawn underline — an occasional pen mark under
                the title so the page reads as authored, not laid out. */}
            <svg
              className="hp-underline hp-underline-title"
              viewBox="0 0 200 10"
              preserveAspectRatio="none"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M2 6.5c34-3.2 70 1.8 104-1.4 26-2.4 60 2.6 92 .6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.85"
              />
            </svg>
          </span>
          <span className="hp-sub">{kitchenTagline(taglineKitchen)}</span>
        </div>
        <img src={welcomeBand} alt="" aria-hidden="true" className="hp-band" />
      </header>

      <div className="hp-hero hp-reveal" style={{ animationDelay: "80ms" }}>
        {renderHero()}
      </div>

      <section className="hp-card hp-reveal" style={{ animationDelay: "160ms" }} aria-labelledby="hp-kitchens-title">
        <div className="hp-card-head">
          <span id="hp-kitchens-title" className="hp-section-title hp-title-mark">
            Your kitchens
            <svg
              className="hp-underline hp-underline-section"
              viewBox="0 0 120 8"
              preserveAspectRatio="none"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M2 5c22-2.4 44 1.4 66-.8 16-1.6 36 1.8 50 .4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.85"
              />
            </svg>
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
          <span id="hp-runs-title" className="hp-section-title hp-title-mark">
            Recent runs
            <svg
              className="hp-underline hp-underline-section"
              viewBox="0 0 110 8"
              preserveAspectRatio="none"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M2 5.4c20-2.6 40 1.2 60-1 14-1.4 32 2 46 .6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.85"
              />
            </svg>
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
              const isAbandoned = r.status !== "completed";
              return (
                <li
                  className={`hp-row hp-row-run hp-reveal${r.hasCard ? "" : " has-no-card"}${isBest ? " is-best" : ""}${isAbandoned ? " is-abandoned" : ""}`}
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
                      aria-label={`Open the cook journal for ${r.title}`}
                    />
                  )}
                  <span className="mono hp-rank">{String(i + 1).padStart(2, "0")}</span>
                  <span className="hp-row-main">
                    <span className="hp-row-title-line">
                      <span className="hp-row-title">{r.title}</span>
                      {isBest && <KpIcon glyph="trophy" size={20} className="hp-trophy" aria-label="Fastest run" />}
                      {isBest && (
                        // A single feather beside the trophy — a small
                        // mark, in the goose's own hand.
                        <svg
                          className="hp-feather"
                          viewBox="0 0 46 76"
                          width="16"
                          height="26"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path d="M33 5c6 16 3 33-6 44-4 5-9 9-13 11 1-13 4-24 8-33" fill="var(--kp-feather-fill, #f7f2e6)" stroke="var(--kp-feather-ink, #8a7a58)" strokeWidth="2.4" strokeLinejoin="round" />
                          <path d="M33 5c-7 12-13 24-16 35-2 8-3 15-3 20" fill="var(--kp-feather-vane, #fffdf7)" stroke="var(--kp-feather-ink, #8a7a58)" strokeWidth="2.4" strokeLinejoin="round" />
                          <path d="M33 5 14 60v12" stroke="var(--kp-feather-ink, #8a7a58)" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      )}
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
                  {isAbandoned && <Footprints seed={r.id} />}
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
