// How much of an ingredient a single step uses.
//
// The graph has always carried per-step amounts (node.material_usage),
// but only the generator ever set them: a step added or edited by hand
// had none, and the Ingredients tab fell back to the material's own
// total. That made the total a number nobody could act on — it did not
// follow the steps, so halving a step changed nothing.
//
// Now the total is the sum of the steps, and a step with no recorded
// amount falls back to an even split of the material's total across the
// steps that use it. The fallback is deliberately the split rather than
// the whole amount: with it, a plan nobody has touched adds up to
// exactly the totals it showed before.

/** Steps that list this material. */
export function stepsUsing(nodes, materialId) {
  return nodes.filter((n) => (n.required_materials || []).includes(materialId));
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * { amount, unit } for one step, or null when nothing is known about
 * the material at all.
 *
 * A shared step's own breakdown wins over the split: the generator
 * records what each dish needs of it (garlic: 3 cloves for one dish,
 * 2 for the other), and the step buys the sum.
 */
export function stepMaterialAmount(nodes, node, materialId, materialsInfo = {}) {
  const raw = rawStepAmount(nodes, node, materialId, materialsInfo);
  return { amount: raw.amount == null ? null : round2(raw.amount), unit: raw.unit };
}

// The same figure unrounded. The total sums these rather than the
// rounded ones: three steps splitting 200ml show 66.67 each, and
// rounding before adding would put the total at 200.01 — a plan nobody
// has touched has to add up to exactly what it did before.
function rawStepAmount(nodes, node, materialId, materialsInfo = {}) {
  const recorded = node.material_usage?.[materialId];
  if (recorded && recorded.amount != null) return { amount: recorded.amount, unit: recorded.unit || materialsInfo[materialId]?.unit || "" };

  const breakdown = (node.usage_breakdown || [])
    .map((u) => u.material_usage?.[materialId])
    .filter((u) => u && u.amount != null);
  if (breakdown.length) {
    return { amount: breakdown.reduce((sum, u) => sum + Number(u.amount), 0), unit: breakdown[0].unit || materialsInfo[materialId]?.unit || "" };
  }

  const info = materialsInfo[materialId];
  if (!info || info.amount == null) return { amount: null, unit: info?.unit || "" };
  const share = stepsUsing(nodes, materialId).length || 1;
  return { amount: Number(info.amount) / share, unit: info.unit || "" };
}

/**
 * What the Ingredients tab shows for a material: the sum of what the
 * live steps use. Falls back to the material's own amount when no step
 * uses it at all (nothing to sum).
 */
export function materialTotal(nodes, materialId, materialsInfo = {}) {
  const users = stepsUsing(nodes, materialId);
  const info = materialsInfo[materialId];
  if (!users.length) return { amount: info?.amount ?? null, unit: info?.unit || "" };
  const parts = users.map((n) => rawStepAmount(nodes, n, materialId, materialsInfo));
  const known = parts.filter((p) => p.amount != null);
  if (!known.length) return { amount: null, unit: parts[0]?.unit || info?.unit || "" };
  return {
    amount: round2(known.reduce((sum, p) => sum + Number(p.amount), 0)),
    unit: known[0].unit || info?.unit || "",
  };
}
