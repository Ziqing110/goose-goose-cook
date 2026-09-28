// The share image behind "Save the page" (design: "Share Card
// Directions", 2a/2b "The receipt"): the keepsake the kitchen hands you.
// Mode stamp and date at the head, the dish, a small print of the photo,
// the result block, every step itemised, the totals, Toque's sign-off,
// and the wordmark as the printer's footer.
//
// Drawn straight onto a 1080×1350 canvas (4:5), with no DOM capture. The
// size is fixed so the result block stays legible in a chat preview; steps
// that don't fit fold into "…and N more steps", and the journal page keeps
// the full list. It reads
// the same derivations the Cook journal's own receipt does (the saved
// summary through summaryOutcome() and resultPlayers()), so the image
// and the page can't disagree about a step, a score or a colour.
import sHead from "../assets/brand/s-head-64.png";
import { chefAvatar } from "./cooks.js";
import { playerBird, playerRing } from "./playerColors.js";
import { PRINT_DEPTHS, PRINT_PATH } from "./gooseMarks.js";
import { clock, planDelta } from "./serviceResults.js";
import { wordmarkGeometry } from "./wordmark.js";

const CARD_W = 1080;
const CARD_H = 1350;

// The paper: a centred strip with a torn bottom edge.
const PAPER_X = 130;
const PAPER_W = 820;
const PAPER_H = 1256;
const PAD_TOP = 56;
const PAD_X = 48;
const PAD_BOTTOM = 36;
const LEFT = PAPER_X + PAD_X;
const RIGHT = PAPER_X + PAPER_W - PAD_X;
const INNER_W = RIGHT - LEFT;
const MID = CARD_W / 2;
const ROW_H = 34;

// --kp-* tokens, as hex: a canvas can't read CSS variables.
// Player colours: fixed A blue / B orange for names, scores and bars;
// only the avatar ring follows the bird each player picked.
const PLAYER = {
  a: { color: "#2f7dd1", ink: "#2664a7" },
  b: { color: "#e58a1f", ink: "#b76e19" },
};

const C = {
  bg: "#ffffff",
  bgSecondary: "#f7f6f3",
  text: "#1a1a1a",
  secondary: "#6e6e6b",
  tertiary: "#a3a29e",
  paper: "#fffdf7",
  paperEdge: "#e6dcc6",
  paperPunch: "#f2ead8",
  paperDash: "#d8ccb1",
  done: "#2e7d32",
};

const INTER = "Inter, ui-sans-serif, system-ui, sans-serif";
const BRICO = "'Bricolage Grotesque', Inter, ui-sans-serif, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

const FONTS = [
  `800 112px ${BRICO}`,
  `700 48px ${INTER}`,
  `600 22px ${INTER}`,
  `400 22px ${INTER}`,
  `500 18px ${MONO}`,
];

/**
 * Renders the card for a saved summary and returns a PNG data URL.
 * `outcome` is summaryOutcome(summary); `players` is resultPlayers(), in
 * player order, so index 0 is player "a".
 */
export async function renderShareCard({ summary, outcome, players: seats }) {
  // A canvas doesn't ask for a webfont the page hasn't used yet, and a
  // face that isn't ready draws in the fallback.
  await Promise.all(FONTS.map((f) => document.fonts.load(f).catch(() => null)));

  const versus = summary.mode === "competition";
  // The photo as taken, same as the journal page shows it.
  const photoUrl = summary.photo;
  const avatarUrls = seats.map((p) => (p.cook?.avatar ? chefAvatar(p.cook.avatar).src : null));
  const [photo, head, ...avatars] = await Promise.all([loadImage(photoUrl), loadImage(sHead), ...avatarUrls.map(loadImage)]);
  const players = seats.map((p, i) => ({
    ...p,
    avatar: avatars[i],
    tone: { ...(PLAYER[p.key] || PLAYER.a), ring: playerRing(p.cook, p.i), tint: playerBird(p.cook, p.i).bg },
  }));
  const byCook = new Map(players.map((p) => [p.cook.id, p]));

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  drawPaper(ctx);

  // ---- head: mode stamp · date and clock, then the dish ----
  let y = PAD_TOP;
  drawHead(ctx, y, versus ? "Versus" : "Co-op", `${formatDate(summary.createdAt)} · ${clock(summary.totalSec)}`);
  y += 36 + 18;
  const dishLines = balanceLines(ctx, summary.dish || "Dinner", `700 48px ${INTER}`, INNER_W, 2);
  ctx.fillStyle = C.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  dishLines.forEach((line, i) => ctx.fillText(line, MID, y + 27 + i * 54));
  y += dishLines.length * 54;

  // ---- the photo, printed small ----
  if (photo) {
    y += 22;
    drawPhoto(ctx, photo, MID - 220, y, 440, 200);
    y += 200;
  }

  // ---- the result block ----
  if (versus) {
    y += 26;
    drawVersus(ctx, y, players, outcome.winnerCookIds || []);
    y += 170;
  } else {
    y += 28;
    drawCoop(ctx, y, outcome, players);
    y += 280;
  }

  // ---- the footer, anchored to the bottom of the paper ----
  const footTop = drawFooter(ctx, outcome, head);

  // ---- every step, as many as fit between the two ----
  y += 24;
  dashedRule(ctx, LEFT, RIGHT, y + 1);
  y += 2 + 8;
  const budget = Math.max(1, Math.floor((footTop - y) / ROW_H));
  const steps = outcome.perStep;
  const fits = steps.length <= budget;
  const shown = fits ? steps : steps.slice(0, budget - 1);
  const rows = shown.map((step) => ({ step, player: byCook.get(step.cookId), ...rightColumn(step, byCook.get(step.cookId), versus) }));
  // The design's right column is 64 wide; a Co-op step that ran ten
  // minutes off plan ("−12:58") needs more, and the column stays one
  // width for every row so the times still line up.
  ctx.font = `500 18px ${MONO}`;
  const rightW = Math.max(64, ...rows.map((r) => ctx.measureText(r.right).width));
  rows.forEach((row, i) => drawStepRow(ctx, y + i * ROW_H, row, rightW));
  if (!fits) {
    ctx.font = `400 20px ${INTER}`;
    ctx.fillStyle = C.secondary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`…and ${steps.length - shown.length} more steps`, MID, y + shown.length * ROW_H + ROW_H / 2);
  }

  return canvas.toDataURL("image/png");
}

// ---------------------------------------------------------------- paper

function drawPaper(ctx) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(PAPER_X, 0, PAPER_W, PAPER_H);
  ctx.strokeStyle = C.paperEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAPER_X + 0.5, 0);
  ctx.lineTo(PAPER_X + 0.5, PAPER_H);
  ctx.moveTo(PAPER_X + PAPER_W - 0.5, 0);
  ctx.lineTo(PAPER_X + PAPER_W - 0.5, PAPER_H);
  ctx.stroke();

  // The torn edge: 20-wide, 20-deep teeth hanging off the bottom.
  const zig = [];
  for (let x = 0; x < PAPER_W; x += 20) zig.push([x, 0], [x + 10, 20]);
  zig.push([PAPER_W, 0]);
  const top = PAPER_H - 1;
  ctx.beginPath();
  ctx.moveTo(PAPER_X, top - 2);
  zig.forEach(([x, dy]) => ctx.lineTo(PAPER_X + x, top + dy));
  ctx.lineTo(PAPER_X + PAPER_W, top - 2);
  ctx.closePath();
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.beginPath();
  zig.forEach(([x, dy], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, PAPER_X + x, top + dy));
  ctx.strokeStyle = C.paperEdge;
  ctx.stroke();
}

function drawHead(ctx, top, mode, meta) {
  const stampFont = `800 20px ${BRICO}`;
  const stampText = mode.toUpperCase();
  const stampW = trackedWidth(ctx, stampText, stampFont, 0.12 * 20) + 24 + 4;
  const metaFont = `500 18px ${MONO}`;
  const metaW = trackedWidth(ctx, meta, metaFont, 0.08 * 18);
  const x = MID - (stampW + 18 + metaW) / 2;
  drawStamp(ctx, x, top, stampW, 36, stampText, stampFont, 0.12 * 20, C.text);
  ctx.fillStyle = C.secondary;
  ctx.textBaseline = "middle";
  drawTracked(ctx, meta, x + stampW + 18, top + 18, metaFont, 0.08 * 18);
}

function drawPhoto(ctx, img, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = C.paperDash;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
  const ix = x + 9;
  const iy = y + 9;
  const iw = w - 18;
  const ih = h - 18;
  ctx.fillStyle = C.paperPunch;
  ctx.fillRect(ix, iy, iw, ih);
  // Cover-crop, focused 45% from the top: food sits a little above the
  // middle of most plates shot from above.
  const scale = Math.max(iw / img.width, ih / img.height);
  const sw = iw / scale;
  const sh = ih / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.45, sw, sh, ix, iy, iw, ih);
}

// --------------------------------------------------------------- versus

function drawVersus(ctx, top, players, winnerCookIds) {
  const [a, b] = players;
  if (!a || !b) return;
  const tie = winnerCookIds.length > 1;

  // Score row: avatar · A : B · avatar, the numbers in each player's ink.
  const digits = Math.max(String(a.entry.points).length, String(b.entry.points).length);
  const size = digits >= 3 ? 96 : 112;
  const font = `800 ${size}px ${BRICO}`;
  const track = -0.02 * size;
  const parts = [
    [String(a.entry.points), a.tone.ink],
    [":", C.tertiary],
    [String(b.entry.points), b.tone.ink],
  ];
  const widths = parts.map(([t]) => trackedWidth(ctx, t, font, track));
  const scoreW = widths.reduce((s, w) => s + w, 0) + 12 * 2;
  const rowW = 76 + 26 + scoreW + 26 + 76;
  let x = MID - rowW / 2;
  const cy = top + 52;
  drawAvatar(ctx, x + 38, cy, 76, 3, a);
  x += 76 + 26;
  ctx.textBaseline = "middle";
  parts.forEach(([t, color], i) => {
    ctx.fillStyle = color;
    drawTracked(ctx, t, x, cy, font, track);
    x += widths[i] + 12;
  });
  drawAvatar(ctx, x - 12 + 26 + 38, cy, 76, 3, b);

  // Names row: A [WINNER] · [WINNER] B, or A [DEAD HEAT] B.
  const nameFont = `800 28px ${BRICO}`;
  const stampFont = `800 18px ${BRICO}`;
  const stampTrack = 0.12 * 18;
  const stampOf = (text) => ({ text, w: trackedWidth(ctx, text, stampFont, stampTrack) + 20 + 4 });
  const aWon = !tie && winnerCookIds.includes(a.cook.id);
  const bWon = !tie && winnerCookIds.includes(b.cook.id);
  const middle = tie ? [{ stamp: stampOf("DEAD HEAT"), color: C.text }] : [{ dot: true }];
  const items = [
    { name: a.cook.name, color: a.tone.ink },
    ...(aWon ? [{ stamp: stampOf("WINNER"), color: a.tone.ink }] : []),
    ...middle,
    ...(bWon ? [{ stamp: stampOf("WINNER"), color: b.tone.ink }] : []),
    { name: b.cook.name, color: b.tone.ink },
  ];
  ctx.font = nameFont;
  const dotW = ctx.measureText("·").width;
  const fixed = items.reduce((s, it) => s + (it.stamp ? it.stamp.w : it.dot ? dotW : 0), 0) + 16 * (items.length - 1);
  const perName = (INNER_W - fixed) / 2;
  items.forEach((it) => {
    if (it.name != null) it.text = fitText(ctx, it.name, nameFont, perName);
    if (it.text != null) it.w = ctx.measureText(it.text).width;
  });
  const namesW = items.reduce((s, it) => s + (it.stamp ? it.stamp.w : it.dot ? dotW : it.w), 0) + 16 * (items.length - 1);
  x = MID - namesW / 2;
  const ny = top + 104 + 10 + 16;
  items.forEach((it) => {
    if (it.stamp) {
      drawStamp(ctx, x, ny - 16, it.stamp.w, 32, it.stamp.text, stampFont, stampTrack, it.color);
      x += it.stamp.w + 16;
    } else {
      ctx.font = nameFont;
      ctx.fillStyle = it.dot ? C.tertiary : it.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(it.dot ? "·" : it.text, x, ny);
      x += (it.dot ? dotW : it.w) + 16;
    }
  });
}

// ---------------------------------------------------------------- co-op

function drawCoop(ctx, top, outcome, players) {
  const { show, deltaSec } = planDelta(outcome);
  const under = show && deltaSec < 0;
  const ribbonColor = under ? C.done : C.text;
  const ribbon = under ? `${clock(-deltaSec)} under plan` : "Dinner's up";
  const planned = outcome.estimatedSec != null ? `planned ${clock(outcome.estimatedSec)}` : null;
  let sub;
  if (show && deltaSec <= 0) sub = [planned, "a win for both"];
  else if (show) sub = [planned, `${clock(deltaSec)} over, still dinner`];
  else sub = [planned || "cooked together"];

  const x0 = LEFT;
  const x1 = RIGHT;
  ctx.fillStyle = C.bgSecondary;
  roundRect(ctx, x0, top, INNER_W, 280, 4);
  ctx.fill();
  ctx.fillStyle = ribbonColor;
  ctx.fillRect(x0, top, INNER_W, 4);

  // The notched ribbon, hung across the top edge.
  const rx = MID - 150;
  const ry = top - 22;
  ctx.beginPath();
  [[0, 0], [300, 0], [288, 20], [300, 40], [0, 40], [12, 20]].forEach(([px, py], i) =>
    (i ? ctx.lineTo : ctx.moveTo).call(ctx, rx + px, ry + py),
  );
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  drawTrackedCentered(ctx, ribbon.toUpperCase(), MID, ry + 20, `800 20px ${BRICO}`, 0.2 * 20);

  ctx.fillStyle = C.secondary;
  drawTrackedCentered(ctx, "COOKED IN", MID, top + 34 + 12, `700 20px ${INTER}`, 0.12 * 20);
  ctx.fillStyle = C.text;
  drawTrackedCentered(ctx, clock(outcome.totalSec), MID, top + 34 + 24 + 2 + 52, `800 104px ${BRICO}`, -0.02 * 104);
  ctx.font = `600 22px ${INTER}`;
  ctx.fillStyle = C.secondary;
  ctx.textAlign = "center";
  ctx.fillText(sub.filter(Boolean).join(" · "), MID, top + 34 + 24 + 2 + 104 + 6 + 14);

  // Who did what: both players, then a bar split by steps done.
  const [a, b] = players;
  const barTop = top + 280 - 20 - 12;
  const rowCy = barTop - 10 - 22;
  const side = (INNER_W - 48 - 20) / 2;
  if (a) drawCoopSide(ctx, a, x0 + 24, rowCy, side, "left");
  if (b) drawCoopSide(ctx, b, x1 - 24, rowCy, side, "right");
  const doneA = a?.entry.doneCount || 0;
  const doneB = b?.entry.doneCount || 0;
  const total = doneA + doneB;
  const barW = INNER_W - 48;
  const wA = total ? ((barW - 4) * doneA) / total : (barW - 4) / 2;
  ctx.save();
  roundRect(ctx, x0 + 24, barTop, barW, 12, 6);
  ctx.clip();
  ctx.fillStyle = a ? a.tone.color : C.tertiary;
  ctx.fillRect(x0 + 24, barTop, wA, 12);
  ctx.fillStyle = b ? b.tone.color : C.tertiary;
  ctx.fillRect(x0 + 24 + wA + 4, barTop, barW - wA - 4, 12);
  ctx.restore();
}

function drawCoopSide(ctx, p, edge, cy, maxW, align) {
  const steps = `${p.entry.doneCount} ${p.entry.doneCount === 1 ? "step" : "steps"}`;
  const stepsFont = `600 22px ${INTER}`;
  const nameFont = `800 28px ${BRICO}`;
  ctx.font = stepsFont;
  const stepsW = ctx.measureText(steps).width;
  const name = fitText(ctx, p.cook.name, nameFont, maxW - 44 - 12 - 12 - stepsW);
  const nameW = ctx.measureText(name).width;
  const dir = align === "left" ? 1 : -1;
  let x = edge;
  drawAvatar(ctx, x + dir * 22, cy, 44, 3, p);
  x += dir * (44 + 12);
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  ctx.font = nameFont;
  ctx.fillStyle = p.tone.ink;
  ctx.fillText(name, x, cy);
  x += dir * (nameW + 12);
  ctx.font = stepsFont;
  ctx.fillStyle = C.secondary;
  ctx.fillText(steps, x, cy);
  ctx.textAlign = "left";
}

// ----------------------------------------------------------------- rows

// Versus: the points, in the finisher's ink. Co-op: the step against its
// plan, green when it came in at or under.
function rightColumn(step, player, versus) {
  if (step.status !== "done") return { right: "", rightInk: C.secondary };
  if (versus && step.points > 0) return { right: `+${step.points}`, rightInk: player ? player.tone.ink : C.secondary };
  if (!versus && step.estSec > 0) {
    const delta = Math.round((step.actualSec || 0) - step.estSec);
    return {
      right: delta === 0 ? "±0" : `${delta < 0 ? "−" : "+"}${clock(Math.abs(delta))}`,
      rightInk: delta <= 0 ? C.done : C.secondary,
    };
  }
  return { right: "", rightInk: C.secondary };
}

function drawStepRow(ctx, top, { step, player, right, rightInk }, rightW) {
  const cy = top + ROW_H / 2;
  const done = step.status === "done";
  if (player) drawAvatar(ctx, LEFT + 12, cy, 24, 2, player);
  else {
    ctx.save();
    ctx.strokeStyle = C.paperDash;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(LEFT + 12, cy, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const mono = `500 18px ${MONO}`;
  ctx.font = mono;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = rightInk;
  ctx.fillText(right, RIGHT, cy);
  const time = done ? clock(step.actualSec || 0) : "skipped";
  const timeRight = RIGHT - rightW - 12;
  const timeW = ctx.measureText(time).width;
  ctx.fillStyle = done ? C.text : C.secondary;
  ctx.fillText(time, timeRight, cy);

  const labelX = LEFT + 24 + 12;
  const labelFont = `600 22px ${INTER}`;
  const label = fitText(ctx, step.label, labelFont, timeRight - timeW - 12 - 12 - 12 - labelX);
  const labelW = ctx.measureText(label).width;
  ctx.textAlign = "left";
  ctx.fillStyle = done ? C.text : C.secondary;
  ctx.fillText(label, labelX, cy);
  if (!done) {
    ctx.fillRect(labelX, cy, labelW, 2);
  }

  const leaderFrom = labelX + labelW + 12;
  const leaderTo = timeRight - timeW - 12;
  if (leaderTo > leaderFrom) {
    ctx.save();
    ctx.strokeStyle = C.paperDash;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.setLineDash([0, 4]);
    ctx.beginPath();
    ctx.moveTo(leaderFrom + 1, cy + 5);
    ctx.lineTo(leaderTo, cy + 5);
    ctx.stroke();
    ctx.restore();
  }
}

// --------------------------------------------------------------- footer

// Bottom-up from the paper's padding: signature · sign-off · totals, with
// a dashed rule over them. Returns the rule's y, where the rows must stop.
function drawFooter(ctx, outcome, head) {
  const bottom = PAPER_H - PAD_BOTTOM;

  // The printer's footer: S head 44 + the hand wordmark at cap 26.
  const { glyphs, stroke, viewBox } = wordmarkGeometry("hand");
  const cap = 26;
  const scale = cap / 100;
  const wmW = viewBox[2] * scale;
  const wmH = viewBox[3] * scale;
  const sigW = 44 + 12 + wmW;
  const sigTop = bottom - 44;
  let x = MID - sigW / 2;
  if (head) ctx.drawImage(head, x, sigTop, 44, 44);
  x += 44 + 12;
  ctx.save();
  ctx.translate(x - viewBox[0] * scale, sigTop + (44 - wmH) / 2 - viewBox[1] * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = C.text;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  glyphs.forEach((g) => {
    ctx.save();
    ctx.translate(g.x, 0);
    ctx.stroke(new Path2D(g.d));
    ctx.restore();
  });
  ctx.restore();

  // Kitchen closed. — Toque, between two footprints.
  const signCy = sigTop - 14 - 14;
  const sign = "Kitchen closed. — Toque";
  ctx.font = `400 22px ${INTER}`;
  const signW = ctx.measureText(sign).width;
  const rowW = 20 + 12 + signW + 12 + 20;
  x = MID - rowW / 2;
  drawPrint(ctx, x + 10, signCy, PRINT_DEPTHS.mid);
  ctx.fillStyle = C.secondary;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(sign, x + 32, signCy);
  drawPrint(ctx, x + rowW - 10, signCy, PRINT_DEPTHS.deep);

  // Totals, in the receipt's mono.
  const totalsCy = signCy - 14 - 14 - 11;
  const planned = outcome.estimatedSec != null ? ` · PLANNED ${clock(outcome.estimatedSec)}` : "";
  const totals = `${outcome.doneCount} DONE · ${outcome.skippedCount} SKIPPED${planned}`;
  ctx.fillStyle = C.secondary;
  drawTrackedCentered(ctx, totals, MID, totalsCy, `500 18px ${MONO}`, 0.04 * 18);

  const ruleY = totalsCy - 11 - 14 - 2;
  dashedRule(ctx, LEFT, RIGHT, ruleY + 1);
  return ruleY;
}

// A footprint 20 wide, turned to walk left to right, like the page's.
function drawPrint(ctx, cx, cy, depth) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-92 * Math.PI) / 180);
  const s = 20 / 26;
  ctx.scale(s, s);
  ctx.translate(-13, -14);
  const path = new Path2D(PRINT_PATH);
  ctx.fillStyle = depth.fill;
  ctx.fill(path);
  ctx.strokeStyle = depth.stroke;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

// ------------------------------------------------------------- elements

// The ringed avatar, PlayerAvatar's rule: the chef bird the player
// picked on its own tint, ringed in that bird's colour, or their initial
// on the player colour for a cook who predates avatars.
function drawAvatar(ctx, cx, cy, d, ring, player) {
  const { tone } = player;
  const r = d / 2;
  const chef = player.cook?.avatar ? chefAvatar(player.cook.avatar) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = chef && player.avatar ? tone.tint : tone.color;
  ctx.fillRect(cx - r, cy - r, d, d);
  if (chef && player.avatar) {
    ctx.drawImage(player.avatar, cx - r, cy - r, d, d);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.round(d * 0.42)}px ${INTER}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(player.cook?.name?.[0]?.toUpperCase() || "?", cx, cy);
  }
  ctx.restore();
  ctx.strokeStyle = chef && player.avatar ? tone.ring : tone.color;
  ctx.lineWidth = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, r - ring / 2, 0, Math.PI * 2);
  ctx.stroke();
}

// The goose's rubber stamp: an outlined box at radius 4, tilted −3°.
function drawStamp(ctx, x, y, w, h, text, font, track, color) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 4);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  drawTrackedCentered(ctx, text, 0, 1, font, track);
  ctx.restore();
}

function dashedRule(ctx, x0, x1, y) {
  ctx.save();
  ctx.strokeStyle = C.paperDash;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ text

// Letter-spacing by hand: ctx.letterSpacing isn't in every browser that
// can save this card. Kerning inside a tracked word is lost, which the
// uppercase stamps and digits this is used for don't miss.
function trackedWidth(ctx, text, font, track) {
  ctx.font = font;
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + track;
  return w - track;
}

function drawTracked(ctx, text, x, y, font, track) {
  ctx.font = font;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + track;
  }
}

function drawTrackedCentered(ctx, text, cx, y, font, track) {
  drawTracked(ctx, text, cx - trackedWidth(ctx, text, font, track) / 2, y, font, track);
}

// The longest prefix of `text` that fits in `maxW`, with an ellipsis if
// anything was cut. Leaves ctx.font set to `font`.
function fitText(ctx, text, font, maxW) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

// Up to `max` lines, broken at the word gap that makes the lines most
// even (text-wrap: balance); the last line ellipsised if it still runs
// over.
function balanceLines(ctx, text, font, maxW, max) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW || max < 2) return [fitText(ctx, text, font, maxW)];
  const words = text.split(" ");
  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const first = words.slice(0, i).join(" ");
    const rest = words.slice(i).join(" ");
    const w1 = ctx.measureText(first).width;
    if (w1 > maxW) break;
    const worst = Math.max(w1, ctx.measureText(rest).width);
    if (!best || worst < best.worst) best = { first, rest, worst };
  }
  if (!best) return [fitText(ctx, text, font, maxW)];
  return [best.first, fitText(ctx, best.rest, font, maxW)];
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

function loadImage(src) {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
