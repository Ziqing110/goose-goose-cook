import { resultPlayers } from "../../utils/serviceResults.js";
import { clock } from "../../utils/time.js";
import { CoopResult, StepReceipt, VersusResults } from "../../components/ServiceResults.jsx";
import Mono from "../../components/Mono.jsx";
import summaryVersusArt from "../../assets/summary-versus-v2-blue.png";
import summaryCoopArt from "../../assets/summary-coop-v2-blue.png";

// Service done (design v7): a results screen, not a summary. The
// illustration across the top, then — Versus — the two players' tickets
// either side of the final score, the winner marked by a banner and a
// tinted head, never by being bigger; — Co-op — how the night went
// against the plan and one shared bar of who did what. The receipt on
// the right is every step, in the order the night went.
export default function ServiceDone({ outcome, cooks, isVersus, title, byId, dishOf, onExit, saving, saveError }) {
  const players = resultPlayers({ outcome, cooks, dishOfStep: (s) => dishOf(byId[s.id]) });

  return (
    <div className={`lc-service ${isVersus ? "is-versus" : "is-coop"}`}>
      <div className="lc-service-main">
        <div className="lc-service-top">
          <span className="lc-eyebrow-label">Service done · {isVersus ? "Versus" : "Co-op"}</span>
          <span className="lc-meta">
            <Mono className="lc-service-clock">{clock(outcome.totalSec)}</Mono> on the clock
          </span>
        </div>
        <img className="lc-service-art" src={isVersus ? summaryVersusArt : summaryCoopArt} alt="" />

        {isVersus ? (
          <VersusResults players={players} winnerCookIds={outcome.winnerCookIds} />
        ) : (
          <CoopResult outcome={outcome} players={players} />
        )}
      </div>

      {/* The receipt is as tall as the column beside it and scrolls
          inside — the cell is the grid item, the roll is taken out of
          flow, so twenty rows never stretch the page past the results.
          The way on is the receipt's own tear-off stub: the receipt is
          what becomes the cook card, so taking it is the handoff. */}
      <div className="lc-service-steps-cell">
        <div className="lc-receipt-roll">
        <StepReceipt outcome={outcome} cooks={cooks} players={players} isVersus={isVersus} title={title} />
        <div className={`lc-receipt-stub ${saving ? "is-tearing" : ""}`}>
          <span className="lc-perforation" aria-hidden="true">
            <span>Tear here</span>
          </span>
          <button type="button" className="btn lc-btn-xl lc-btn-go lc-service-cta" onClick={onExit} disabled={saving}>
            {saving ? "Saving…" : saveError ? "Try again" : "Take the cook card →"}
          </button>
          {saveError && (
            <p className="lc-service-error" role="alert">
              {saveError} Nothing is lost — try again.
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
