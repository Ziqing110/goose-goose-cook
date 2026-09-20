// A rolling window of the microphone's recent audio, addressable by the
// same clock the recogniser uses.
//
// Speaker identification needs the audio of one turn, and the turn only
// arrives as text with word timestamps (ms since the stream began). So the
// mic feeds every chunk it sends to the recogniser into this ring too, and
// a turn's clip is cut out afterwards by those timestamps.
//
// Chunks are a fixed length and only chunks actually SENT are pushed, so
// chunk k covers stream time [k*chunkMs, (k+1)*chunkMs), which is the
// recogniser's own timeline. Pure: no DOM, so the indexing is testable.

/**
 * @param {object} opts
 *   chunkMs    length of every pushed chunk
 *   maxChunks  how many to remember (800 x 50ms = 40s)
 */
export function createAudioRing({ chunkMs = 50, maxChunks = 800 } = {}) {
  let chunks = [];
  let firstIndex = 0; // stream index of chunks[0]
  let rate = 0;
  let startWall = 0; // wall-clock ms of stream time zero
  let live = false;

  const concat = (parts) => {
    const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    parts.forEach((p) => {
      out.set(p, at);
      at += p.length;
    });
    return out;
  };

  const ring = {
    /** A new stream began: forget everything and restart the clock. */
    reset(sampleRate, wallNow = Date.now()) {
      chunks = [];
      firstIndex = 0;
      rate = sampleRate;
      startWall = wallNow;
      live = true;
    },
    /** The stream ended. What is already buffered stays readable. */
    stop() {
      live = false;
    },
    push(chunk) {
      chunks.push(chunk);
      if (chunks.length > maxChunks) {
        chunks.shift();
        firstIndex += 1;
      }
    },
    isLive: () => live,

    /** Audio for stream time [startMs, endMs), or null if it has aged out. */
    sliceStream(startMs, endMs) {
      const from = Math.max(firstIndex, Math.floor(startMs / chunkMs));
      const to = Math.min(firstIndex + chunks.length, Math.ceil(endMs / chunkMs));
      if (to <= from || !rate) return null;
      return { pcm: concat(chunks.slice(from - firstIndex, to - firstIndex)), rate };
    },

    /** Audio between two wall-clock times. */
    sliceWall(fromWall, toWall) {
      return ring.sliceStream(fromWall - startWall, toWall - startWall);
    },

    /**
     * Loudness (RMS, int16 units) of each chunk since a wall-clock time,
     * with the wall-clock time the first one began. For finding where
     * speech starts and stops; see utils/speechActivity.js.
     */
    levelsSince(wall) {
      const from = Math.max(0, Math.floor((wall - startWall) / chunkMs) - firstIndex);
      const levels = chunks.slice(from).map((c) => {
        let sum = 0;
        for (let i = 0; i < c.length; i += 1) sum += c[i] * c[i];
        return Math.sqrt(sum / (c.length || 1));
      });
      return { levels, startWall: startWall + (firstIndex + from) * chunkMs };
    },

    /** How much audio has been captured since a wall-clock time. */
    secondsSince(wall) {
      const bufferedFrom = startWall + firstIndex * chunkMs;
      const bufferedTo = startWall + (firstIndex + chunks.length) * chunkMs;
      return Math.max(0, bufferedTo - Math.max(wall, bufferedFrom)) / 1000;
    },
  };
  return ring;
}
