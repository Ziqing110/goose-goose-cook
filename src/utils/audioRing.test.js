import test from "node:test";
import assert from "node:assert/strict";
import { createAudioRing } from "./audioRing.js";

// 4 samples per 50ms chunk keeps the arithmetic readable.
const chunk = (n) => Int16Array.from([n, n, n, n]);

function filled(count, opts) {
  const ring = createAudioRing({ chunkMs: 50, ...opts });
  ring.reset(16000, 1_000);
  for (let i = 0; i < count; i++) ring.push(chunk(i));
  return ring;
}

test("a stream-time slice returns exactly the chunks that cover it", () => {
  const ring = filled(10);
  const clip = ring.sliceStream(100, 250); // chunks 2,3,4
  assert.deepEqual([...clip.pcm], [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.equal(clip.rate, 16000);
});

test("a slice rounds outward so no word is clipped", () => {
  const clip = filled(10).sliceStream(110, 240); // 110ms sits in chunk 2, 240ms in chunk 4
  assert.deepEqual([...clip.pcm].filter((_, i) => i % 4 === 0), [2, 3, 4]);
});

test("wall-clock slices use the stream start", () => {
  const clip = filled(10).sliceWall(1_100, 1_250);
  assert.deepEqual([...clip.pcm].filter((_, i) => i % 4 === 0), [2, 3, 4]);
});

test("audio older than the window is gone, and the indexing survives the eviction", () => {
  const ring = filled(6, { maxChunks: 4 }); // keeps chunks 2..5
  assert.equal(ring.sliceStream(0, 100), null);
  const clip = ring.sliceStream(100, 300);
  assert.deepEqual([...clip.pcm].filter((_, i) => i % 4 === 0), [2, 3, 4, 5]);
});

test("nothing before the stream started, nothing past what was captured", () => {
  const ring = filled(4);
  assert.equal(ring.sliceStream(500, 900), null);
  assert.equal(createAudioRing().sliceStream(0, 100), null);
});

test("secondsSince counts captured audio, not elapsed time", () => {
  const ring = filled(20); // 1.0s captured, from wall 1000 to 2000
  assert.equal(ring.secondsSince(1_000), 1);
  assert.equal(ring.secondsSince(1_500), 0.5);
  assert.equal(ring.secondsSince(5_000), 0); // recording began after the mic stopped
  assert.equal(ring.secondsSince(0), 1); // recording began before the mic opened
});

test("reset starts a fresh clock", () => {
  const ring = filled(10);
  ring.reset(48000, 9_000);
  ring.push(chunk(7));
  assert.deepEqual([...ring.sliceStream(0, 50).pcm], [7, 7, 7, 7]);
  assert.equal(ring.sliceStream(0, 50).rate, 48000);
});
