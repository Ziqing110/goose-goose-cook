// One cook's station ticket, and what it is focused on.
import { useState } from "react";
import { activeStepFor, canUndo, claimSuggestions, DIFFICULTY_POINTS, passiveStepsFor, stepVariance, versusWaiting } from "../../utils/liveCook.js";
import { playerKey } from "../../utils/serviceResults.js";
import { hasDeadline, isAttended, isOneShot, momentName } from "../../utils/tending.js";
import { clock } from "../../utils/time.js";
import { PlayerAvatar, Stamp } from "../../components/ServiceResults.jsx";
import { GoosePrint, GooseTracks } from "../../components/GooseMarks.jsx";
import BabyGoose from "../../components/BabyGoose.jsx";
import CardGoose from "../../components/CardGoose.jsx";
import KpIcon from "../../components/KpIcon.jsx";
import Mono from "../../components/Mono.jsx";
import { EquipmentChip, GOOSE, MomentAxis, momentState, PointsTag, TendingChip } from "./parts.jsx";

// Copy that is the engine's own — reproduced verbatim on the card.
const EYEBROW = {
  active: "On it",
  assigned: "Up next",
  idle_fill: "Free hands? Take this",
  waiting: "Waiting",
  finished: "Done for the night",
  grabs: "Up for grabs",
  paused: "Paused",
};

// What a cook's card is about right now, shared by the card and the page
// (which needs to know whether ANY card has a pot going, so both cards
// reserve the "on its own" slot together). The engine says who is
// occupied by what. If a check comes due while the cook is mid-chop,
// both steps occupy them and the engine's pick is by record order — the
// card keeps the hands-on step so it does not flip under a working
// cook; the due check is the row's alarm. Only with no hands-on step
// does an unattended moment lead.
export function cardFocus(cookId, run, byId, now) {
  const handsOnId = Object.entries(run.steps).find(([id, r]) => r.status === "active" && r.cookId === cookId && isAttended(byId[id]))?.[0] || null;
  const activeId = handsOnId || activeStepFor(cookId, run, byId, now);
  const node = activeId ? byId[activeId] : null;
  // The card is "On it" on an unattended step only while it is in a
  // moment — the engine never makes a merely-waiting pot anyone's focus.
  const focusMoment = node && !isAttended(node) ? momentState(node, run.steps[activeId], now) : null;
  // Every unattended step this cook has going, soonest moment first.
  // A pot stays listed even while its check is the card's focus, so the
  // row and the card agree — except during Start: the cook is standing
  // at that pot getting it going, and there is nothing to come back to.
  const cooking = passiveStepsFor(cookId, run, byId)
    .filter((id) => !(id === activeId && focusMoment?.phase === "initial"))
    .map((id) => ({ id, node: byId[id], state: momentState(byId[id], run.steps[id], now) }))
    .sort((a, b) => (a.state.nextInSec ?? -1) - (b.state.nextInSec ?? -1));
  return { activeId, node, focusMoment, cooking };
}

// Coop's head stamp, one per state.
const STAMP = {
  active: "On it",
  assigned: "Up next",
  idle_fill: "Free hands",
  waiting: "Waiting",
  finished: "Done",
};

// The station ticket (design: "Live cook v7"): the Schedule's opening-
// hand paper scaled up. Four zones in a fixed order on every state —
// head, the order, the action block, the pots cooking on their own —
// and both cards share the row tracks, so like sits level with like
// whatever state either card is in. A state may leave a zone quiet; it
// never removes one.
export default function PlayerFocusCard({ cardRef, scoreRef, cook, index, cooks, run, nodes, byId, now, isVersus, paused, assignment, points, doneCount, dishOf, ownSlot, landing, handoff, claimNote, claimBlock, onStart, onDone, onSkip, onDrop, onClaim, onPass, onUndo }) {
  const key = playerKey(index);
  const other = cooks.find((c) => c.id !== cook.id) || null;
  const { activeId, node, focusMoment, cooking } = cardFocus(cook.id, run, byId, now);
  const variance = node ? stepVariance(node, run.steps[activeId], now) : null;
  const inFinish = focusMoment?.phase === "ending";

  // Versus has no plan: with nothing in hand the card offers the top
  // suggestion and points at the board for the rest. "Not now" moves
  // to the next one; once every suggestion has been waved off the
  // first comes round again — the board is still there for the rest.
  const [waved, setWaved] = useState(() => new Set());
  const suggestions = isVersus && !activeId ? claimSuggestions({ nodes, run, cookId: cook.id, limit: 6 }) : [];
  const suggestion = suggestions.find((id) => !waved.has(id)) ?? suggestions[0] ?? null;
  const notNow = () => {
    if (!suggestion) return;
    const next = new Set(waved).add(suggestion);
    setWaved(suggestions.every((id) => next.has(id)) ? new Set([suggestion]) : next);
  };
  const otherBusy = other ? Boolean(activeStepFor(other.id, run, byId, now)) : true;
  // Versus: nothing to grab is waiting, not finished, while anything is
  // still open -- "Done for the night" mid-run read as being sent home.
  const versusWait = isVersus && !activeId && !suggestion ? versusWaiting(run, nodes, now) : null;
  const reason = activeId ? "active" : isVersus ? (suggestion ? "grabs" : versusWait ? "waiting" : "finished") : assignment?.reason || "waiting";
  const waitInfo = isVersus ? versusWait : assignment;
  const offeredId = reason === "grabs" ? suggestion : reason === "assigned" || reason === "idle_fill" ? assignment?.stepId : null;
  const offered = offeredId ? byId[offeredId] : null;
  // Versus: the offer greys out for the same reasons a board tile would.
  const offerBlock = reason === "grabs" && offeredId && claimBlock ? claimBlock(offeredId, cook.id) : null;
  const undoable = !paused && canUndo({ run, nodes, cookId: cook.id, at: new Date(now).toISOString() });

  const waitingOn = waitInfo?.waitingOnStepId ? byId[waitInfo.waitingOnStepId] : null;
  const waitingCookIndex = waitInfo?.waitingOnCookId ? cooks.findIndex((c) => c.id === waitInfo.waitingOnCookId) : -1;

  // Due: a check or the finish is open on something this cook has going
  // — the card's own focus or a pot in the row below. The card shakes
  // once (the class change starts it), the goose honks until it's handled.
  const isDue = (m, n) => Boolean(m?.current) && hasDeadline(n) && (m.phase === "checkpoint" || m.phase === "ending");
  const due = !paused && ((focusMoment && isDue(focusMoment, node)) || cooking.some((c) => isDue(c.state, c.node)));

  const phaseLabel = focusMoment?.current ? momentName(focusMoment.current, focusMoment.checkCount) : null;
  const eyebrowText = paused ? EYEBROW.paused : EYEBROW[reason];
  const stampText = paused ? "Paused" : due ? "Due" : STAMP[reason];

  const silhouette = due ? "due" : reason;
  // The head band fills with the player's tint while their hands are on
  // something — "this is my station" at a glance.
  const active = reason === "active" || due;
  const goosePose = due ? GOOSE.due : handoff && reason === "active" ? GOOSE.handoff : GOOSE[reason] || GOOSE.waiting;
  const gooseMotion = due ? "honk" : reason === "waiting" ? "none" : "bob";
  // The rail fills to est, then turns amber (the "is-over" tint).
  const heatPct = variance ? Math.min(100, variance.estSec > 0 ? (variance.actualSec / variance.estSec) * 100 : 100) : 0;
  const bodyNode = node || offered;
  // The ticket number: this cook's how-many-th ticket tonight. It used to
  // be the step's index in the recipe data over the step count, which
  // read as progress — and put "#13 / 20" on the first card of the night.
  const ticketNo = bodyNode ? `Ticket ${String(doneCount + 1).padStart(2, "0")}` : `${doneCount} done`;

  const secondary = (
    <>
      {focusMoment && !inFinish && (
        // Mid-moment the banner holds the slot; this ends the whole step,
        // not just the moment, so it says so.
        <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onDone(activeId)}>
          Done early
        </button>
      )}
      <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onSkip(activeId)}>
        Skip
      </button>
      {isVersus && (
        <button type="button" className="btn btn-ghost" disabled={paused} onClick={() => onDrop(activeId)}>
          Put it back
        </button>
      )}
      <button type="button" className="btn btn-ghost lc-btn-undo" disabled={!undoable} onClick={onUndo}>
        Undo
      </button>
    </>
  );

  return (
    <article
      ref={cardRef}
      className={`lc-card is-${key} is-state-${silhouette} ${active ? "is-active" : ""} ${reason === "grabs" ? "is-offer" : ""} ${paused ? "is-paused" : ""}`}
      aria-label={`${cook.name} — ${eyebrowText}`}
    >
      {/* A — the ticket head: who, which ticket, and (Versus) the score
          roundel where "+20" lands, or (Co-op) the state as a stamp. */}
      <header className="lc-card-head">
        <PlayerAvatar cook={cook} index={index} size={44} />
        <span className="lc-card-id">
          <span className="lc-card-name">{cook.name}</span>
          <Mono className="lc-card-ticket">{ticketNo}</Mono>
        </span>
        {isVersus ? (
          <span className="lc-card-score" ref={scoreRef}>
            <span className={`lc-card-points ${landing ? "is-landing" : "lc-roll"}`} key={points}>
              {points}
            </span>
            <span className="lc-card-pts">pts</span>
          </span>
        ) : (
          <Stamp key={stampText} tone={due ? "due" : key}>
            {stampText}
          </Stamp>
        )}
      </header>

      {/* B — the order: what it is, what it needs, what to do with your
          hands, and the clock pinned to the bottom of the zone. */}
      <div className="lc-card-body">
        {bodyNode && (
          <>
            <div className="lc-order-brow">
              {due && (
                <span className="lc-chip is-due">
                  <KpIcon glyph="timer" size={14} />
                  {phaseLabel ? `${phaseLabel} — now` : "Due now"}
                </span>
              )}
              {!due && phaseLabel && <span className={`lc-chip is-phase is-${key}`}>{phaseLabel}</span>}
              {dishOf(bodyNode) && <span className="lc-order-dish">{dishOf(bodyNode)}</span>}
              {(bodyNode.required_equipment || []).map((e) => (
                <EquipmentChip key={e} type={e} />
              ))}
              <TendingChip node={bodyNode} />
            </div>
            {isVersus && <PointsTag pts={DIFFICULTY_POINTS[bodyNode.difficulty]} player={key} />}
            <h2 className="lc-step-title">{bodyNode.label}</h2>
            {/* The description is the instruction — the one thing on the
                card that says what to do with your hands. */}
            {bodyNode.description && <p className="lc-step-desc">{bodyNode.description}</p>}
            {node && focusMoment?.current?.kind === "initial" && isOneShot(node) && (
              <p className="lc-meta">Then it runs on its own — nothing to come back for.</p>
            )}
            {claimNote?.stepId === offeredId && offeredId && (
              <p key={claimNote.key} className="lc-claim-note" role="status">
                {claimNote.text}
              </p>
            )}
            <span className="lc-order-spacer" />
            {node ? (
              // Elapsed against est. Past est the rail turns amber and the
              // right end says by how much.
              <div className={`lc-step-rail is-${key} ${variance.over ? "is-over" : ""}`}>
                <Mono className="lc-timer-value">{clock(variance.actualSec)}</Mono>
                <span className="lc-step-rail-track" aria-hidden="true">
                  <span className="lc-step-rail-fill" style={{ width: `${heatPct.toFixed(1)}%` }} />
                </span>
                <Mono className="lc-timer-est">{variance.over ? `${clock(variance.deltaSec)} over` : clock(variance.estSec)}</Mono>
              </div>
            ) : reason === "grabs" ? (
              <div className="lc-step-rail is-offer">
                <Mono className="lc-timer-value">{clock(offered.estimated_duration_sec)}</Mono>
                <span className="lc-meta">if you take it</span>
                <Stamp tone={key} className="lc-offer-stamp">
                  Up for grabs
                </Stamp>
              </div>
            ) : (
              <div className={`lc-step-rail is-${key}`}>
                <Mono className="lc-timer-value is-idle">0:00</Mono>
                <span className="lc-step-rail-track" aria-hidden="true" />
                <Mono className="lc-timer-est">{clock(offered.estimated_duration_sec)}</Mono>
              </div>
            )}
          </>
        )}

        {reason === "waiting" && (
          // Hands free: the countdown takes the title's place, big — it
          // is the one thing a waiting cook wants to know.
          <>
            <div className="lc-order-brow">
              <span className="lc-order-dish">Hands free</span>
            </div>
            {waitInfo?.etaSec != null ? (
              <div className="lc-wait">
                <span className="lc-wait-num">{clock(waitInfo.etaSec)}</span>
                <span className="lc-wait-unit">left</span>
              </div>
            ) : (
              <h2 className="lc-step-title is-quiet">Nothing to do yet</h2>
            )}
            <p className="lc-step-desc lc-waiting-copy">
              {waitingOn ? (
                <>
                  Waiting on &ldquo;{waitingOn.label}&rdquo;
                  {waitingCookIndex === index ? (
                    // Your own pot is what everything waits on.
                    <>{" "}&mdash; yours, cooking on its own</>
                  ) : waitingCookIndex >= 0 && (
                    <>
                      {" "}&mdash; {cooks[waitingCookIndex].name} has it
                      <PlayerAvatar cook={cooks[waitingCookIndex]} index={waitingCookIndex} size={20} />
                    </>
                  )}
                  .
                </>
              ) : (
                isVersus ? "Nothing open to grab yet." : "Waiting on the other player."
              )}
            </p>
            <GooseTracks variant="up" />
          </>
        )}

        {reason === "finished" && (
          <div className="lc-rest">
            <BabyGoose pose={GOOSE.finished} size={96} paused={paused} decorative />
            <span className="lc-rest-copy">
              <h2 className="lc-step-title">Done for the night</h2>
              <span className="lc-rest-tally">
                <Mono>{doneCount}</Mono> done
                {isVersus && (
                  <>
                    {" "}· <Mono className="lc-rest-pts">{points}</Mono> pts
                  </>
                )}
              </span>
              <span className="lc-meta">Nothing left for you.</span>
            </span>
          </div>
        )}
      </div>

      {/* C — the action block: two fixed slots, a 56px primary and a
          row of quiet ghosts, on every state whether or not it fills
          them. The goose lives in the reserved right margin. */}
      <div className="lc-card-actions">
        {reason !== "finished" && <CardGoose pose={goosePose} size={100} paused={paused} motion={paused ? "none" : gooseMotion} />}
        <div className="lc-primary-slot">
          {node &&
            (focusMoment && !inFinish ? (
              // Start / Check: the moment's instruction and countdown take
              // the primary's slot — "do the thing, then walk away".
              <MomentInstruction state={focusMoment} />
            ) : (
              <button
                type="button"
                // Finish: the primary IS the Done, and it springs once
                // when the window opens.
                className={`btn lc-btn-xl lc-btn-done ${inFinish ? "lc-attend" : ""}`}
                key={inFinish ? "finish" : "done"}
                disabled={paused}
                onClick={() => onDone(activeId)}
              >
                {inFinish ? "Checked it" : "Done"}
              </button>
            ))}
          {offered && (
            <button
              type="button"
              // The offer pulses once every 4 s — the only loop on this card.
              className={`btn lc-btn-xl lc-btn-go ${reason === "grabs" && !paused && !offerBlock ? "lc-offer-pulse" : ""}`}
              disabled={paused || Boolean(offerBlock)}
              title={offerBlock || undefined}
              onClick={() => (reason === "grabs" ? onClaim(offeredId) : onStart(offeredId))}
            >
              {reason === "assigned" ? "Start" : reason === "idle_fill" ? "Take this" : "Take it"}
            </button>
          )}
        </div>
        {/* Always rendered, so the primary above it sits at the same
            height on both cards. A player's last Done/Skip stays
            undoable for 60s even after their card has moved on. */}
        <div className="lc-card-secondary">
          {node ? (
            secondary
          ) : (
            <>
              {reason === "grabs" && (
                <>
                  <button type="button" className="btn btn-ghost" disabled={paused || suggestions.length < 2} onClick={notNow}>
                    Not now
                  </button>
                  {other && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={paused || otherBusy}
                      title={otherBusy ? `${other.name} is still on something` : undefined}
                      onClick={() => onPass(offeredId, other.id)}
                    >
                      Pass to {other.name}
                    </button>
                  )}
                </>
              )}
              {undoable && (
                <button type="button" className="btn btn-ghost lc-btn-undo" onClick={onUndo}>
                  Undo
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* D — every pot this cook has going, its next moment counting
          down. When either card has one, both reserve the slot, so the
          cards stay one height; the empty one says so quietly. */}
      {cooking.length > 0 ? (
        <div className="lc-cooking">
          {cooking.map(({ id, node: cNode, state }) => (
            <CookingRow
              key={id}
              node={cNode}
              state={state}
              player={key}
              paused={paused}
              // Done never appears twice in one card: the row's Done is
              // suppressed only when this same step is the card's
              // primary (its Finish-phase card).
              showDone={!isOneShot(cNode) && state.phase === "ending" && !(activeId === id && inFinish)}
              onDone={() => onDone(id)}
            />
          ))}
        </div>
      ) : (
        ownSlot && (
          <div className="lc-cooking-empty">
            <GoosePrint depth="mid" size={12} />
            <span className="lc-own-eyebrow">On its own</span>
            <span>Nothing on the burner</span>
          </div>
        )
      )}
    </article>
  );
}

// The moment banner, in the action block's primary slot: what to do
// and this moment's countdown. The whole step's clock is the rail.
function MomentInstruction({ state }) {
  const { current, countdownSec } = state;
  const verb = current.kind === "initial" ? "Get it going" : current.kind === "checkpoint" ? "Check on it" : "Pull it off";
  return (
    <div className="lc-moment" role="timer">
      <KpIcon glyph="timer" size={22} />
      {/* The countdown beside it is the time; repeating the moment's
          length here made three clocks on one card. */}
      <span className="lc-moment-instruction">{verb}{current.kind === "ending" ? " — now." : "."}</span>
      {current.kind !== "ending" && <Mono className="lc-moment-countdown">{clock(countdownSec)}</Mono>}
    </div>
  );
}

// One "on its own" row: the pot, its live axis, and the next moment.
// Quiet while running; the system's "needs you" treatment (warning
// tint, one pop) when a check or the finish is due.
function CookingRow({ node, state, player, paused, showDone, onDone }) {
  const { phase, current, next, checkCount, countdownSec, late, lateSec, readyInSec } = state;
  const due = hasDeadline(node) && (phase === "checkpoint" || phase === "ending");
  let label = "";
  let value = "";
  if (due) {
    label = `${momentName(current, checkCount)} — now`;
    value = late ? `+${clock(lateSec)}` : clock(countdownSec);
  } else if (isOneShot(node)) {
    label = readyInSec > 0 ? "Ready in" : "";
    value = readyInSec > 0 ? clock(readyInSec) : "Ready";
  } else if (next) {
    label = `${momentName(next, checkCount)} in`;
    value = clock(state.nextInSec);
  } else if (phase === "initial" && current) {
    label = "Starting";
    value = clock(countdownSec);
  }
  return (
    <div className={`lc-cooking-row is-${player} ${due ? "is-due" : ""}`} key={due ? `${phase}-${current?.index}` : "running"}>
      <KpIcon glyph="pot" size={14} />
      <span className="lc-own-eyebrow">On its own</span>
      <span className="lc-cooking-row-label">{node.label}</span>
      <MomentAxis state={state} player={player} compact />
      <span className="lc-cooking-row-next">
        {label && <span className="lc-cooking-row-next-label">{label}</span>}
        <Mono className="lc-cooking-row-next-value">{value}</Mono>
      </span>
      {showDone && (
        <button type="button" className="btn lc-cooking-row-done" disabled={paused} onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}
