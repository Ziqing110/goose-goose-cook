// Building the frozen summary record, plus the image work behind the
// photo and the download. The share card itself is drawn in shareCard.js.
import { cookColorKey } from "./cooks.js";
import { buildRunContext, cookQuipStats, pickQuips, headlineFor } from "./cookQuips.js";

const MAX_PHOTO_PX = 1200;

/**
 * Snapshot of a finished cook. Frozen deliberately: it's a record of one
 * evening, so it shouldn't change later when scoring rules or quip copy do.
 */
export function buildSummary({ outcome, cooks, dish, mode, dishOfStep = () => null, photo = null, styledPhoto = null, photoSource = null }) {
  const context = buildRunContext(outcome, outcome.scoreboard.map((b) => b.cookId).join("-"));
  const topPoints = outcome.scoreboard[0]?.points ?? 0;

  return {
    createdAt: new Date().toISOString(),
    dish,
    mode,
    totalSec: outcome.totalSec,
    estimatedSec: outcome.estimatedSec,
    winnerCookIds: outcome.winnerCookIds,
    doneCount: outcome.doneCount,
    skippedCount: outcome.skippedCount,
    headline: headlineFor(context),
    cooks: outcome.scoreboard.map((entry, i) => {
      const stats = cookQuipStats(entry, outcome.perStep);
      return {
        cookId: entry.cookId,
        name: entry.name,
        colorKey: cookColorKey(cooks.findIndex((c) => c.id === entry.cookId)),
        points: entry.points,
        // Equal points share a rank — consistent with co-winners.
        rank: outcome.scoreboard.filter((b) => b.points > entry.points).length + 1,
        isWinner: entry.points === topPoints && topPoints > 0,
        doneCount: entry.doneCount,
        skippedCount: entry.skippedCount,
        quips: pickQuips(stats, context),
        steps: outcome.perStep
          .filter((s) => s.cookId === entry.cookId && s.status !== "pending")
          .map((s) => ({
            label: s.label,
            status: s.status,
            estSec: s.estSec,
            actualSec: s.actualSec,
            deltaSec: s.deltaSec,
            points: s.points,
          })),
        _order: i,
      };
    }),
    // Every step in the order the night went — the cook card's receipt,
    // the same one Service done printed. `dish` is for "Most points from".
    // Steps never reached stay in, as on Service done's receipt.
    perStep: outcome.perStep.map((s) => ({
      id: s.id,
      label: s.label,
      cookId: s.cookId,
      status: s.status,
      estSec: s.estSec,
      actualSec: s.actualSec,
      points: s.points,
      dish: dishOfStep(s),
    })),
    photo,
    styledPhoto,
    photoSource,
  };
}

/** Read a File into a downscaled data URL so the row stays a sane size. */
export function fileToDataUrl(file, maxPx = MAX_PHOTO_PX) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That doesn't look like an image"));
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Local stand-in for the image model: a warm grade, a vignette and a
 * little grain. Used when the backend returns `source: "stub"`, so the
 * user still gets a visibly different "styled" version — labelled as a
 * local effect rather than passed off as generated.
 */
export function applyLocalStyle(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Could not style that image"));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.filter = "saturate(1.25) contrast(1.12) sepia(0.18) brightness(1.04)";
      ctx.drawImage(img, 0, 0);
      ctx.filter = "none";

      const { width: w, height: h } = canvas;
      const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(40,24,10,0.42)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      const grain = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < grain.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 12;
        grain.data[i] += n;
        grain.data[i + 1] += n;
        grain.data[i + 2] += n;
      }
      ctx.putImageData(grain, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.src = dataUrl;
  });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
