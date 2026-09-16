// Inventory — the materials check between the conversation and the
// main line (design/claude-design-materials-prompt.md, "Kitchen Path
// Inventory v3"). One input: uncheck what you're out of. Everything
// else — coverage, reach, blocked/at-risk steps — is derived in
// utils/inventory.js from the same availability rules the main line
// uses. The "out" set is session state (session.outMaterialIds) so the
// main line reads the same thing.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/AppStateContext.jsx";
import { useSessionRecipes } from "../state/useSessionRecipes.js";
import { buildInventory, formatClock, formatStepDuration, PHASE_LABELS } from "../utils/inventory.js";
import dishMapoTofu from "../assets/dish-mapo-tofu.png";
import dishNoodleSoup from "../assets/dish-noodle-soup.png";
import "./InventoryPage.css";

// The system's two dish marks. Matched by title keyword; a dish with
// no mark simply shows none (the title carries the meaning).
function dishMarkFor(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("tofu")) return dishMapoTofu;
  if (t.includes("noodle") || t.includes("soup")) return dishNoodleSoup;
  return null;
}

function Mono({ children }) {
  return <span className="mono">{children}</span>;
}

function Checkbox({ checked, label, onChange }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${label} — ${checked ? "on hand" : "out"}`}
      className={`inv-check ${checked ? "is-on" : ""}`}
      onClick={onChange}
    >
      <span className="inv-check-box" aria-hidden="true">
        {checked && (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.4 12.4l3.2 3.2 6-6.6" />
          </svg>
        )}
      </span>
    </button>
  );
}

function StepLine({ step, delay }) {
  return (
    <div className="inv-step" style={{ animationDelay: `${delay}ms` }}>
      <span className="inv-step-main">
        <Mono>
          <span className="inv-step-num">{step.number}</span>
        </Mono>
        <span className={`inv-step-phase is-${step.phase}`}>
          <span className="inv-step-phase-dot" />
          <Mono>{PHASE_LABELS[step.phase] || step.phase}</Mono>
        </span>
        <span className="inv-step-label">{step.label}</span>
        <Mono>
          <span className="inv-step-dur">{formatStepDuration(step.durationSec)}</span>
        </Mono>
      </span>
      {step.split.length > 0 && (
        <span className="inv-step-sub">
          {step.split.map((s, i) => (
            <span key={s.title}>
              {i > 0 && " · "}
              <Mono>
                {s.amount} {s.unit}
              </Mono>{" "}
              — {s.title}
            </span>
          ))}
        </span>
      )}
      {step.dependsOn.length > 0 && (
        <span className="inv-step-sub inv-step-deps">
          after{" "}
          {step.dependsOn.map((d, i) => (
            <span key={d.number}>
              {i > 0 && " · "}
              <Mono>{d.number}</Mono> {d.label}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function IngredientRow({ item, onToggle, delay }) {
  const onHand = !item.out;
  return (
    <li className={`inv-row ${onHand ? "" : "is-out"}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="inv-row-head">
        <Checkbox checked={onHand} label={item.label} onChange={onToggle} />
        <span className="inv-row-main">
          <span className="inv-row-title-line">
            <span className="inv-row-title">{item.label}</span>
            {item.amount != null && (
              <Mono>
                <span className="inv-row-amount">
                  {item.amount} {item.unit}
                </span>
              </Mono>
            )}
            {!onHand && <span className="inv-chip inv-chip-out">Out</span>}
            {item.isCustom && <span className="inv-chip inv-chip-added">Added by you</span>}
          </span>
          <span className="inv-row-meta">
            <span>
              used in <Mono>{item.usedIn.length}</Mono> {item.usedIn.length === 1 ? "step" : "steps"}
            </span>
            {item.dishes.map((d) => (
              <span key={d} className="inv-chip inv-chip-dish">
                {d}
              </span>
            ))}
          </span>
        </span>
        <span className={`inv-reach mono is-${item.reachTone}`}>
          → {item.reach} {item.reach === 1 ? "step" : "steps"}
        </span>
      </div>
      <div className="inv-row-detail">
        {item.usedIn.map((step, i) => (
          <StepLine key={step.id} step={step} delay={i * 60} />
        ))}
      </div>
    </li>
  );
}

export default function InventoryPage() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const session = state.session;
  const { recipes, sharedSteps = [], outMaterialIds = [] } = session;
  const { catalog, catalogError, retryCatalog } = useSessionRecipes();
  const [showAllImpact, setShowAllImpact] = useState(false);

  const inv = useMemo(
    () => buildInventory({ recipes, sharedSteps, catalog, outIds: outMaterialIds }),
    [recipes, sharedSteps, catalog, outMaterialIds]
  );

  const hasDishes = recipes.length > 0;
  const hasOut = outMaterialIds.length > 0;
  const loading = hasDishes && !catalog && !catalogError;

  useEffect(() => {
    dispatch({
      type: "voice/setHint",
      payload: { hint: { line: "Tell me what you're out of — say “no ginger”.", sub: "Everything's on hand until you say otherwise." } },
    });
    return () => dispatch({ type: "voice/setHint", payload: { hint: null } });
  }, [dispatch]);

  const setOut = (ids) => dispatch({ type: "session/update", payload: { outMaterialIds: ids } });
  const toggle = (id) => {
    const next = new Set(outMaterialIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setOut([...next]);
  };
  const markAllOnHand = () => setOut([]);

  const { coverage } = inv;
  const metaBits = [];
  if (hasDishes) {
    metaBits.push(inv.title);
    if (inv.servings != null) metaBits.push(<><Mono>{inv.servings}</Mono> servings</>);
    if (catalog) metaBits.push(<><Mono>{inv.ingredients.length}</Mono> ingredients</>);
    metaBits.push(<><Mono>{inv.stepCount}</Mono> steps</>);
    metaBits.push(<Mono>{formatClock(inv.totalSeconds)}</Mono>);
  }

  // Blocked entries and at-risk entries with their own missing
  // ingredient always show; pure downstream cascades fold past the
  // first few so the panel stays a summary, not a second step list.
  const IMPACT_VISIBLE = 5;
  const impactVisible = showAllImpact ? inv.impact : inv.impact.slice(0, IMPACT_VISIBLE);
  const impactHidden = inv.impact.length - impactVisible.length;

  const dishMarks = inv.dishTitles.map((t) => ({ title: t, src: dishMarkFor(t) })).filter((d) => d.src);

  return (
    <section className="page inventory-page">
      <header className="inv-title-row">
        <div className="inv-title">
          <h1>Inventory</h1>
          {!hasDishes ? (
            <span className="inv-meta is-tertiary">
              The agent is still setting your dishes <span className="mono inv-dots">…</span>
            </span>
          ) : loading ? (
            <span className="inv-meta is-tertiary">Loading your ingredients…</span>
          ) : (
            <span className="inv-meta">
              {metaBits.map((bit, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {bit}
                </span>
              ))}
            </span>
          )}
        </div>
        {dishMarks.length > 0 && (
          <span className="inv-dish-marks" aria-hidden="true">
            {dishMarks.map((d, i) => (
              <img key={d.title} src={d.src} alt="" className="inv-dish-mark" style={{ animationDelay: `${120 + i * 80}ms` }} />
            ))}
          </span>
        )}
      </header>

      {hasDishes && catalogError && (
        <div className="inv-hud inv-hud-error">
          <div className="inv-error-block">Couldn&rsquo;t load the ingredient catalog: {catalogError}</div>
          <button type="button" className="btn" onClick={retryCatalog}>
            Retry
          </button>
        </div>
      )}

      {hasDishes && catalog && (
        <>
          {/* ---- Coverage HUD ---- */}
          <div className="inv-hud">
            <div className="inv-hud-head">
              <span className={`inv-summary is-${coverage.tone}`}>{coverage.summary}</span>
              {hasOut && (
                <button type="button" className="btn btn-ghost inv-btn-accent" onClick={markAllOnHand}>
                  Mark everything on hand
                </button>
              )}
            </div>
            <div className="inv-stats">
              <div className="inv-stat inv-stat-wide">
                <span className="inv-stat-value mono inv-roll" style={{ animationDelay: "300ms" }}>
                  {inv.onHandCount}
                  <span className="inv-stat-sep"> / </span>
                  {inv.ingredients.length}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">ingredients </span>on hand
                </span>
              </div>
              <div className="inv-stat">
                <span className="inv-stat-value mono inv-roll" style={{ animationDelay: "360ms" }}>
                  {coverage.atRisk}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">steps </span>at risk
                </span>
              </div>
              <div className="inv-stat">
                <span className={`inv-stat-value mono inv-roll ${coverage.blocked > 0 ? "is-critical" : ""}`} style={{ animationDelay: "420ms" }}>
                  {coverage.blocked}
                </span>
                <span className="inv-stat-label">
                  <span className="inv-long">steps </span>blocked
                </span>
              </div>
            </div>
            <div className="inv-stepbar-wrap">
              <div
                className="inv-stepbar"
                role="img"
                aria-label={`${coverage.craftable} craftable, ${coverage.atRisk} at risk, ${coverage.blocked} blocked`}
              >
                {inv.steps.map((s) => (
                  <span key={s.id} className={`inv-stepbar-seg is-${s.status}`} />
                ))}
              </div>
              <span className="mono inv-stepbar-legend">
                {coverage.craftable} craftable · {coverage.atRisk} at risk · {coverage.blocked} blocked
              </span>
            </div>
          </div>

          {/* ---- Groups + impact ---- */}
          <div className="inv-columns">
            <div className="inv-groups">
              {inv.groups.map((g, gi) => (
                <section key={g.key} className="inv-card" style={{ animationDelay: `${160 + gi * 60}ms` }} aria-labelledby={`inv-group-${g.key}`}>
                  <div className="inv-card-head">
                    <span id={`inv-group-${g.key}`} className="inv-card-title">
                      {g.label}
                    </span>
                    <span className="mono inv-card-count">
                      {g.items.length} · {g.items.filter((i) => !i.out).length} on hand
                    </span>
                  </div>
                  <ul className="inv-list">
                    {g.items.map((item, i) => (
                      <IngredientRow key={item.id} item={item} onToggle={() => toggle(item.id)} delay={220 + gi * 60 + i * 60} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <aside className="inv-impact inv-card" aria-labelledby="inv-impact-title">
              <div className="inv-card-head">
                <span id="inv-impact-title" className="inv-card-title">
                  What this changes
                </span>
              </div>
              {inv.impact.length === 0 ? (
                <div className="inv-impact-empty">Nothing — everything&rsquo;s craftable.</div>
              ) : (
                <ul className="inv-list">
                  {impactVisible.map((e, i) => (
                    <li key={e.id} className={`inv-impact-row is-${e.status}`} style={{ animationDelay: `${i * 60}ms` }}>
                      <span className="inv-impact-dot" aria-hidden="true" />
                      <span className="inv-impact-main">
                        <span className="inv-impact-title-line">
                          <span className="inv-impact-label">{e.label}</span>
                          <Mono>
                            <span className="inv-impact-dur">{formatStepDuration(e.durationSec)}</span>
                          </Mono>
                        </span>
                        <span className="inv-impact-reason">{e.reason}</span>
                      </span>
                    </li>
                  ))}
                  {impactHidden > 0 && (
                    <li>
                      <button type="button" className="inv-impact-more" onClick={() => setShowAllImpact(true)}>
                        + {impactHidden} more at risk downstream
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </aside>
          </div>

          {/* ---- Footer band ---- */}
          <div className="inv-footer">
            <span className="mono inv-footer-tag">
              {coverage.craftable} of {coverage.total} steps craftable
            </span>
            <div className="inv-footer-actions">
              {coverage.blocked > 0 && (
                <button type="button" className="btn btn-ghost inv-btn-accent" onClick={markAllOnHand}>
                  Mark everything on hand
                </button>
              )}
              <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate("/session/recipe-graph")}>
                {coverage.blocked > 0 ? "Set the main line anyway →" : "Set the main line →"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
