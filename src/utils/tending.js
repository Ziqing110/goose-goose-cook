// How much of a cook a step needs while it runs.
//
// This started as a boolean — attended or not — and a boolean turns out
// to hide the distinction that matters most. Three of the five steps in
// a real generated congee run were marked "unattended", and they were
// not the same kind of thing at all:
//
//   Simmer congee base   40min   scorches if nobody stirs it
//   Boil rice and water   8min   boils over if nobody catches it
//   Shock chicken in ice 15min   genuinely walk away
//
// The first two need somebody to come back, on time, or dinner is
// ruined. The third does not care whether you fish the chicken out at
// ten minutes or fifteen. Treating them alike meant nagging people about
// an ice bath, staying silent about a burning pot, and paying the same
// for lifting a lid as for minding a forty-minute congee.
/**
 * The shortest gap between checks you can actually leave the kitchen in.
 *
 * Below this there is no point walking away: you would be back before
 * you had started anything. A step checked more often than this is a
 * hands-on step wearing the wrong label.
 */
export const LEAVABLE_GAP_SEC = 120;

export const TENDING = {
  /** Needs a cook for its whole duration. */
  HANDS_ON: "hands_on",
  /** Runs alone but must be checked while it goes, and finished on time. */
  TENDED: "tended",
  /**
   * Runs alone and needs no checking, but the moment it ends matters —
   * an ice bath you pull the chicken out of at eight minutes. Nothing to
   * do in between; everything depends on being there at the end.
   */
  TIMED: "timed",
  /**
   * Runs alone and nobody minds when you get back to it. Rice that is
   * done at fifty-five minutes is equally done at seventy-five.
   */
  SET_AND_FORGET: "set_and_forget",
};

/**
 * What kind of step this is.
 *
 * Falls back to the older `attended` boolean so existing runs, seeded
 * templates and anything a model emits without the newer field keep
 * working. An unattended step with nothing more said about it is treated
 * as TENDED, not SET_AND_FORGET: assuming a pot needs checking when it
 * does not costs somebody a glance, and assuming it does not when it
 * does costs dinner.
 */
export function tendingOf(node) {
  const declared = node?.tending;
  if (!declared || !Object.values(TENDING).includes(declared)) {
    return node?.attended === false ? TENDING.TENDED : TENDING.HANDS_ON;
  }
  // A risotto that wants a stir every thirty seconds is not an
  // unattended step that happens to need a lot of checking — it is a
  // long hands-on step, and calling it anything else tells the planner
  // the cook is free when they are standing at the pot. If the gap
  // between checks is too short to go and do something else in, the
  // label is simply wrong and is corrected here.
  if (declared === TENDING.TENDED) {
    const every = Number(node?.unattended?.checkpoints?.interval_sec);
    if (Number.isFinite(every) && every > 0 && every < LEAVABLE_GAP_SEC) return TENDING.HANDS_ON;
  }
  return declared;
}

/** The initial/checkpoints/ending breakdown, or null on a hands_on step (or one never decomposed). */
export const unattendedOf = (node) => node?.unattended || null;

/** Does this step occupy a cook for its whole duration? */
export const isAttended = (node) => tendingOf(node) === TENDING.HANDS_ON;

/** Does it run without a cook — either kind of unattended? */
export const runsAlone = (node) => !isAttended(node);

/**
 * Is being late on this step a failure?
 *
 * True for hands-on work and for anything that has to be tended. False
 * for set-and-forget, where five minutes over is not five minutes late —
 * it is simply when somebody got round to it, and marking it "over" in
 * red would be inventing a mistake nobody made.
 */
export const hasDeadline = (node) => tendingOf(node) !== TENDING.SET_AND_FORGET;

/**
 * Is this step finished in one go, at the moment it is started?
 *
 * Rice that nobody is waiting on is not really two events. You put it
 * on, and that is the job — coming back to lift the lid is not work and
 * paying for it invents an achievement. So a set-and-forget step is
 * scored once, in full, like the small hands-on task it actually is.
 */
export const isOneShot = (node) => tendingOf(node) === TENDING.SET_AND_FORGET;

/**
 * Is hitting the end time worth rewarding?
 *
 * True where being late costs something: a congee that has to come off
 * before it catches, an ice bath that wants eight minutes and not
 * fifteen. False for hands-on work, where the timing IS the task and is
 * already scored, and for set-and-forget, where there is no moment to
 * hit.
 */
export const rewardsTimeliness = (node) => {
  const kind = tendingOf(node);
  return kind === TENDING.TENDED || kind === TENDING.TIMED;
};

const TIERS = ["low", "medium", "high"];

/**
 * How many times somebody has to go and look at this step.
 *
 * From the decomposition pass's own checkpoint count. When a step is
 * tended but was never decomposed (a legacy run, or a seeded template
 * that never went through generation), two is assumed — enough to count
 * as tending, not enough to pretend it is constant work.
 */
export function checkCount(node) {
  if (tendingOf(node) !== TENDING.TENDED) return 0;
  const count = Number(node?.unattended?.checkpoints?.count);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 2;
}

/**
 * Difficulty, raised one tier for steps that need tending.
 *
 * An unattended step is really several small hands-on moments stuck
 * together — putting it on, going back to look at it, taking it off —
 * so it is worth more than a single hands-on task of the same rated
 * difficulty. The hands-on part of minding a congee is stirring, which
 * is easy, and a model reasonably calls it "low"; what makes it hard is
 * having to keep coming back.
 *
 * One tier, not more. A step that needs so much attention that it would
 * warrant two is a step nobody can leave, and that is corrected at the
 * source in tendingOf — it becomes hands_on, where its full duration is
 * charged to a cook, which is a much bigger consequence than any
 * difficulty bump.
 *
 * Only TENDED is raised. A timed step asks for one thing, be there at
 * the end, and the timeliness bonus pays for that directly.
 */
export function effectiveDifficulty(node) {
  const declared = node?.difficulty || "low";
  if (tendingOf(node) !== TENDING.TENDED) return declared;
  const at = TIERS.indexOf(declared);
  return TIERS[Math.min(TIERS.length - 1, (at === -1 ? 0 : at) + 1)];
}
