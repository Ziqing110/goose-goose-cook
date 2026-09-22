// Answers that are still being looked up.
//
// A search turn is two model calls plus a web lookup — up to fourteen
// seconds. The live cook cannot wait that long: the agent turn queue is
// serial by design (several calls in one turn must chain, not race), so
// a blocking search would hold up "done with the garlic" behind
// "can I use a shallot".
//
// So the lookup detaches. The first request returns straight away with
// whatever the model already decided plus a short "let me check", and
// the answer is parked here under an id the client collects separately,
// off the queue. Cooking carries on while Goose reads.
//
// In memory on purpose. This is a handful of seconds of state for a run
// that lives in the browser, and a pending answer is worthless once its
// cook has moved on — a store that outlived a restart would be a store
// full of answers to questions nobody remembers asking.

const TTL_MS = 60_000;
// A cap, so a wedged search or a mischievous client cannot grow this
// without bound. Two cooks cannot plausibly have more open questions
// than this at once; the oldest is dropped to make room.
const MAX_OPEN = 8;

const store = new Map(); // id -> { promise, at }

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, entry] of store) {
    if (entry.at < cutoff) store.delete(id);
  }
}

/**
 * Park a promise and get back the id to collect it with.
 * The promise is started by the caller, not here: the lookup should be
 * under way before this function returns, not when someone asks for it.
 */
export function park(promise) {
  sweep();
  if (store.size >= MAX_OPEN) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) store.delete(oldest[0]);
  }
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  // Swallow rejection here so an unclaimed failure is not an unhandled
  // rejection that takes the server down. Whoever claims it still sees
  // the error.
  promise.catch(() => {});
  store.set(id, { promise, at: Date.now() });
  return id;
}

/**
 * Take the parked promise. One collection per id: an answer is spoken
 * once, and leaving it behind would let a retry say it twice.
 * @returns {Promise|null}
 */
export function collect(id) {
  const entry = store.get(String(id ?? ""));
  if (!entry) return null;
  store.delete(id);
  return entry.promise;
}

/** For tests and for a health check that wants to say how deep it is. */
export const openCount = () => {
  sweep();
  return store.size;
};
