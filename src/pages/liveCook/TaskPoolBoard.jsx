// Versus: every step up for grabs, what is taken, and what is not ready yet.
import { DIFFICULTY_POINTS, stepVariance } from "../../utils/liveCook.js";
import { unattendedEvents } from "../../utils/scheduleLayout.js";
import { playerKey } from "../../utils/serviceResults.js";
import { hasDeadline, isAttended, isOneShot, momentName } from "../../utils/tending.js";
import { clock } from "../../utils/time.js";
import { chefAvatar, CHEF_AVATARS } from "../../utils/cooks.js";
import { PlayerAvatar, Stamp } from "../../components/ServiceResults.jsx";
import Mono from "../../components/Mono.jsx";
import { EquipmentChip, momentState, PointsTag, TendingChip } from "./parts.jsx";

// A claim reads as "Leo took it" for this long, then the tile settles
// into its running state.
const CLAIM_FLASH_MS = 4000;

// The board (design v7): small paper tickets on a bg-secondary panel —
// the station ticket's language at tile size. Every tile has the same
// rows (title + points, facts, a tool row that is always reserved, the
// claim halves pinned to the bottom), so a row of tiles shares its
// edges whatever each one holds. A claim stamps the tile with who took
// it, then it settles to the holder and their next moment.
export default function TaskPoolBoard({ ready, blocked, run, byId, cooks, now, paused, dishOf, claimBlock, claimNote, onClaim }) {
  const taken = Object.entries(run.steps).filter(([, r]) => r.status === "active");
  return (
    <section className="lc-pool" aria-label="Up for grabs">
      <header className="lc-pool-head">
        <h2 className="lc-eyebrow-label">Up for grabs</h2>
        <span className="lc-meta">
          <Mono>{ready.length}</Mono> ready · <Mono>{blocked.length}</Mono> not yet
        </span>
      </header>
      <div className="lc-pool-grid">
        {/* One button per player rather than a single "Claim" that scores
            for whoever the speaker toggle happened to be left on. On a
            screen two people share, a tap has to say who tapped. */}
        {ready.map((id) => {
          const tNode = byId[id];
          // What a claim actually costs: an unattended step is mostly
          // waiting, so the tile says its hands-on total, not its span.
          const handsOnSec = isAttended(tNode) ? null : unattendedEvents(tNode, 0).reduce((sum, m) => sum + (m.endSec - m.atSec), 0);
          return (
            <div key={id} className="lc-tile is-claimable">
              <div className="lc-tile-top">
                <span className="lc-tile-label">{tNode.label}</span>
                <PointsTag pts={DIFFICULTY_POINTS[tNode.difficulty]} />
              </div>
              <span className="lc-tile-meta">
                <Mono>{clock(handsOnSec ?? tNode.estimated_duration_sec)}</Mono>
                {handsOnSec != null && <> hands-on of <Mono>{clock(tNode.estimated_duration_sec)}</Mono></>}
                {dishOf(tNode) && <> · {dishOf(tNode)}</>}
              </span>
              {/* What the claim needs from the kitchen: a step's burner or
                  board is what most often refuses a claim, so it's on the
                  tile rather than discovered by tapping. */}
              <div className="lc-chips lc-tile-chips">
                {(tNode.required_equipment || []).map((e) => (
                  <EquipmentChip key={e} type={e} />
                ))}
                <TendingChip node={tNode} />
              </div>
              {claimNote?.stepId === id && (
                <p key={claimNote.key} className="lc-claim-note" role="status">
                  {claimNote.text}
                </p>
              )}
              <div className="lc-tile-claims">
                {cooks.map((cook, i) => {
                  // Greyed for whatever would refuse it — hands full, or
                  // the equipment it needs is on something else.
                  const block = claimBlock(id, cook.id);
                  const why = block ? (block.startsWith("No ") ? block.replace(/^No (.*) free$/, "no $1").toLowerCase() : "busy") : null;
                  // The half wears whichever bird this cook picked, so it
                  // matches the avatar inside it whatever the pair is —
                  // green against purple reads as well as blue against
                  // amber. A cook who never picked one borrows the bird
                  // at their seat rather than the unclaimed grey, which
                  // is what "can't claim" already looks like.
                  const bird = (cook.avatar && chefAvatar(cook.avatar)) || CHEF_AVATARS[i % CHEF_AVATARS.length];
                  return (
                    <button
                      key={cook.id}
                      type="button"
                      className={`btn lc-claim is-${playerKey(i)}`}
                      style={{ "--claim": bird.bg, "--claim-ink": bird.ink }}
                      onClick={() => onClaim(id, cook.id)}
                      disabled={paused || Boolean(block)}
                      title={block || undefined}
                      aria-label={`${cook.name} takes ${tNode.label}`}
                    >
                      <PlayerAvatar cook={cook} index={i} size={20} />
                      <span className="lc-claim-name">
                        {cook.name}
                        {why && <span className="lc-claim-why"> · {why}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {taken.map(([id, record]) => {
          const i = cooks.findIndex((c) => c.id === record.cookId);
          const tNode = byId[id];
          // An unattended step's tile says its next moment, never a plain
          // running time — the same copy as the card's pot row.
          const ms = tNode && !isAttended(tNode) ? momentState(tNode, record, now) : null;
          let moment = null;
          if (ms) {
            if (ms.current?.kind === "initial") moment = "Starting";
            else if (ms.current && hasDeadline(tNode)) moment = `${momentName(ms.current, ms.checkCount)} — now`;
            else if (ms.next) moment = `${momentName(ms.next, ms.checkCount)} in ${clock(ms.nextInSec)}`;
            else if (isOneShot(tNode)) moment = ms.readyInSec > 0 ? `Ready in ${clock(ms.readyInSec)}` : "Ready";
          }
          const fresh = record.startedAt && now - Date.parse(record.startedAt) < CLAIM_FLASH_MS;
          return (
            <div key={id} className={`lc-tile is-taken is-${playerKey(i)} ${fresh ? "is-fresh" : ""}`}>
              <div className="lc-tile-top">
                <span className="lc-tile-label">{tNode?.label}</span>
                <PointsTag pts={DIFFICULTY_POINTS[tNode.difficulty]} player={playerKey(i)} />
              </div>
              <span className="lc-tile-meta">
                <Mono>{clock(tNode.estimated_duration_sec)}</Mono>
                {dishOf(tNode) && <> · {dishOf(tNode)}</>}
              </span>
              {fresh ? (
                <Stamp tone={playerKey(i)} className="lc-tile-took">
                  {cooks[i]?.name} took it
                </Stamp>
              ) : (
                <span className="lc-tile-holder">
                  <PlayerAvatar cook={cooks[i]} index={i} size={20} />
                  {cooks[i]?.name}
                  {moment ? <Mono className={ms.current ? "is-due" : ""}>{moment}</Mono> : <Mono>{clock(stepVariance(tNode, record, now).actualSec)}</Mono>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* What's not ready yet is a row of locked chips (Schedule's NOT
          YET), not tiles: the board is for what can be taken. Each one
          carries what it's waiting on. */}
      {blocked.length > 0 && (
        <div className="lc-pool-notyet">
          <span className="lc-eyebrow-label">Not yet</span>
          {blocked.map((id, i) => {
            const waiting = (byId[id].depends_on || []).filter((d) => byId[d] && !["done", "skipped"].includes(run.steps[d]?.status));
            // Same tilt as the step's chip on Schedule (hashed from its id),
            // on its own beat, so the row reads as steps waiting their turn.
            const hash = String(id).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 5381);
            const tiltDeg = ((hash % 26) - 13) / 10;
            return (
              <span
                key={id}
                className="lc-notyet-chip"
                title={`needs ${waiting.map((d) => byId[d]?.label).join(", ")}`}
                style={{ "--lc-locked-index": i, "--lc-locked-tilt": `${tiltDeg}deg` }}
              >
                {byId[id].label}
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
