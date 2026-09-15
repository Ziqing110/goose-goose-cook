// Building the frozen summary record, plus the image work behind the
// photo and the downloadable share card.
import { cookColorKey } from "./cooks.js";
import { buildRunContext, cookQuipStats, pickQuips, headlineFor } from "./cookQuips.js";

const MAX_PHOTO_PX = 1200;

/**
 * Snapshot of a finished cook. Frozen deliberately: it's a record of one
 * evening, so it shouldn't change later when scoring rules or quip copy do.
 */
export function buildSummary({ outcome, cooks, dish, mode, photo = null, styledPhoto = null, photoSource = null }) {
  const context = buildRunContext(outcome, outcome.scoreboard.map((b) => b.cookId).join("-"));
  const topPoints = outcome.scoreboard[0]?.points ?? 0;

  return {
    createdAt: new Date().toISOString(),
    dish,
    mode,
    totalSec: outcome.totalSec,
    estimatedSec: outcome.estimatedSec,
    winnerCookIds: outcome.winnerCookIds,
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

const CARD_W = 1080;
const CARD_H = 1350;

/** Draws the shareable card by hand — designed rather than a screenshot,
 *  and needs no DOM-capture dependency. */
export async function renderShareCard(summary) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fbf6ec";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const image = summary.styledPhoto || summary.photo;
  const photoH = image ? 620 : 0;
  if (image) {
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(CARD_W / img.width, photoH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CARD_W, photoH);
        ctx.clip();
        ctx.drawImage(img, (CARD_W - w) / 2, (photoH - h) / 2, w, h);
        ctx.restore();
        resolve();
      };
      img.onerror = resolve;
      img.src = image;
    });
  }

  let y = photoH + 78;
  ctx.fillStyle = "#8d8477";
  ctx.font = "500 26px ui-monospace, Menlo, monospace";
  ctx.fillText("KITCHEN PATH", 64, y);

  y += 62;
  ctx.fillStyle = "#201e1d";
  ctx.font = "700 54px system-ui, sans-serif";
  wrapText(ctx, summary.dish || "Dinner", 64, y, CARD_W - 128, 60);

  y += summary.dish && summary.dish.length > 28 ? 128 : 66;
  ctx.fillStyle = "#5c554c";
  ctx.font = "400 30px system-ui, sans-serif";
  ctx.fillText(`${Math.round(summary.totalSec / 60)} min · ${summary.mode}`, 64, y);

  y += 58;
  ctx.fillStyle = "#564a80";
  ctx.font = "italic 400 30px system-ui, sans-serif";
  wrapText(ctx, summary.headline, 64, y, CARD_W - 128, 40);

  y += 110;
  summary.cooks.forEach((cook) => {
    const color = { mia: "#3f77b5", leo: "#d67f48", sage: "#6b9080" }[cook.colorKey] || "#5c554c";
    ctx.fillStyle = color;
    ctx.fillRect(64, y - 34, 10, 46);
    ctx.fillStyle = "#201e1d";
    ctx.font = "700 40px system-ui, sans-serif";
    ctx.fillText(cook.name, 92, y);
    ctx.fillStyle = color;
    ctx.font = "700 46px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(String(cook.points), CARD_W - 64, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "#8d8477";
    ctx.font = "400 26px system-ui, sans-serif";
    ctx.fillText(`${cook.doneCount} steps${cook.isWinner ? " · winner" : ""}`, 92, y + 34);
    y += 96;
  });

  return canvas.toDataURL("image/png");
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let cursor = y;
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line, x, cursor);
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
