"""Local speaker-identification sidecar (NVIDIA TitaNet-large).

Run from the repo root:  npm run speaker
Uses .venv-voice (NeMo + torch cu124). Listens on 127.0.0.1 only.

  GET    /health
  POST   /enroll?cook=<id>&rate=<hz>            body: raw little-endian int16 mono PCM
  POST   /identify?rate=<hz>&candidates=a,b     body: raw int16 mono PCM
  POST   /learn?cook=<id>&rate=<hz>             body: raw int16 mono PCM
  DELETE /voiceprints[?cook=<id>]               one cook, or everyone

/learn adds a turn the app is sure about -- the cook said who they were,
or the match was well clear -- to that cook's voiceprint. Measured on the
kitchen takes, the amount of voice a print is built from is what decides
how many turns can be credited at all: one reading credits about 6 of 34
marked turns, six readings 16, and learning from confident turns adds
two to four more on top without adding a wrong one. Learned samples are
kept apart from the enrolled ones and capped, oldest out first, so a
long cook cannot drift the print away from the reading it started from.

Privacy: this is the reason it is a sidecar and not a cloud call. Audio is
turned into a 192-number embedding and discarded; only embeddings are kept,
in memory and in speaker-sidecar/voiceprints.json (gitignored). Nothing
leaves the machine. DELETE removes them from both.

Scores are cosine similarity between the turn's embedding and each cook's
enrolled embedding. The sidecar reports them raw plus the margin between
the best and runner-up; deciding what counts as a match is the caller's
job, because the right threshold is something to measure on real voices.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import soxr
import torch
from nemo.collections.asr.models import EncDecSpeakerLabelModel

PORT = int(os.environ.get("SPEAKER_PORT", "3103"))
# SPEAKER_STORE points a second copy (an eval, a test) at its own file,
# so it never touches the voiceprints of the cooks actually bound.
STORE = os.environ.get("SPEAKER_STORE") or os.path.join(os.path.dirname(__file__), "voiceprints.json")
TARGET_RATE = 16000
MIN_SECONDS = 0.5   # shorter than this and the embedding is mostly noise
MAX_SECONDS = 30.0
MAX_LEARNED = 20    # per cook; the enrolled reading always stays

def load_model():
    """GPU if it will have us, CPU otherwise.

    The GPU is shared with the browser (Kokoro runs on it via WebGPU, and
    so does everything else on the desktop), so a CUDA out-of-memory here
    is an ordinary event, not a broken install. TitaNet is small and turns
    are a few seconds of audio, so CPU is a fine fallback.
    SPEAKER_DEVICE=cpu forces it.
    """
    wanted = os.environ.get("SPEAKER_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
    for dev in ([wanted] if wanted == "cpu" else [wanted, "cpu"]):
        try:
            print(f"loading TitaNet-large on {dev} ...", flush=True)
            t0 = time.time()
            m = EncDecSpeakerLabelModel.from_pretrained(
                "nvidia/speakerverification_en_titanet_large", map_location=dev
            )
            m = m.to(dev).eval()
            print(f"loaded in {time.time() - t0:.1f}s on {dev}", flush=True)
            return m, dev
        except RuntimeError as err:
            print(f"could not load on {dev}: {str(err).splitlines()[0]}", flush=True)
            if dev == "cuda":
                torch.cuda.empty_cache()
    raise SystemExit("TitaNet would not load on any device")


model, device = load_model()

lock = threading.Lock()
# cook id -> unit-length embeddings, from the reading they enrolled with
prints: dict[str, list[np.ndarray]] = {}
# cook id -> unit-length embeddings from live turns, newest last
learned: dict[str, list[np.ndarray]] = {}


def load_store():
    if not os.path.exists(STORE):
        return
    with open(STORE, "r", encoding="utf-8") as f:
        for cook, entry in json.load(f).items():
            # Older stores are a bare list of enrolled samples.
            if isinstance(entry, list):
                entry = {"enrolled": entry, "learned": []}
            prints[cook] = [np.array(v, dtype=np.float32) for v in entry.get("enrolled", [])]
            learned[cook] = [np.array(v, dtype=np.float32) for v in entry.get("learned", [])]
    print(f"restored voiceprints for {len(prints)} cook(s)", flush=True)


def save_store():
    with open(STORE, "w", encoding="utf-8") as f:
        json.dump({
            k: {"enrolled": [v.tolist() for v in vs], "learned": [v.tolist() for v in learned.get(k, [])]}
            for k, vs in prints.items()
        }, f)


def samples_of(cook):
    return prints.get(cook, []) + learned.get(cook, [])


def embed(pcm_bytes: bytes, rate: int) -> tuple[np.ndarray, float]:
    audio = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
    if rate != TARGET_RATE:
        audio = soxr.resample(audio, rate, TARGET_RATE)
    seconds = len(audio) / TARGET_RATE
    if seconds < MIN_SECONDS:
        raise ValueError(f"only {seconds:.2f}s of audio; need at least {MIN_SECONDS}s")
    audio = audio[: int(MAX_SECONDS * TARGET_RATE)]
    with torch.no_grad():
        signal = torch.from_numpy(audio).unsqueeze(0).to(device)
        length = torch.tensor([signal.shape[1]], device=device)
        _, emb = model.forward(input_signal=signal, input_signal_length=length)
    vec = emb.squeeze(0).float().cpu().numpy()
    return vec / (np.linalg.norm(vec) + 1e-9), seconds


def centroid(vecs):
    c = np.mean(vecs, axis=0)
    return c / (np.linalg.norm(c) + 1e-9)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body=None):
        payload = json.dumps(body if body is not None else {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        # Same-machine page only; the dev server proxies /speaker here, but
        # a direct call from the page's origin should work too.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0)))

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        if urlparse(self.path).path != "/health":
            return self._send(404, {"error": "not found"})
        with lock:
            self._send(200, {
                "ok": True,
                "device": device,
                "enrolled": {k: len(v) for k, v in prints.items()},
                "learned": {k: len(learned.get(k, [])) for k in prints},
            })

    def do_POST(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            rate = int(q.get("rate", TARGET_RATE))
            vec, seconds = embed(self._body(), rate)
        except Exception as err:
            return self._send(400, {"error": str(err)})

        if url.path == "/enroll":
            cook = q.get("cook")
            if not cook:
                return self._send(400, {"error": "cook is required"})
            with lock:
                prints.setdefault(cook, []).append(vec)
                save_store()
                samples = len(prints[cook])
            return self._send(200, {"cook": cook, "samples": samples, "seconds": round(seconds, 2)})

        if url.path == "/learn":
            cook = q.get("cook")
            with lock:
                # Only a cook who enrolled can be learned: a live turn on its
                # own is not a voiceprint anybody agreed to.
                if not cook or cook not in prints:
                    return self._send(404, {"error": "no voiceprint for that cook"})
                bucket = learned.setdefault(cook, [])
                bucket.append(vec)
                del bucket[:-MAX_LEARNED]
                save_store()
                count = len(bucket)
            return self._send(200, {"cook": cook, "learned": count, "seconds": round(seconds, 2)})

        if url.path == "/identify":
            wanted = [c for c in q.get("candidates", "").split(",") if c]
            with lock:
                pool = {c: samples_of(c) for c in prints if not wanted or c in wanted}
                scores = {c: float(np.dot(vec, centroid(vs))) for c, vs in pool.items()}
            ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
            best = ranked[0] if ranked else (None, None)
            margin = (ranked[0][1] - ranked[1][1]) if len(ranked) > 1 else None
            return self._send(200, {
                "cook": best[0],
                "score": None if best[1] is None else round(best[1], 4),
                "margin": None if margin is None else round(margin, 4),
                "scores": {c: round(s, 4) for c, s in scores.items()},
                "seconds": round(seconds, 2),
            })

        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        url = urlparse(self.path)
        if url.path != "/voiceprints":
            return self._send(404, {"error": "not found"})
        cook = parse_qs(url.query).get("cook", [None])[0]
        with lock:
            if cook:
                prints.pop(cook, None)
                learned.pop(cook, None)
            else:
                prints.clear()
                learned.clear()
            save_store()
        self._send(200, {"deleted": cook or "all"})

    def log_message(self, *args):
        pass


load_store()
print(f"speaker sidecar -> http://127.0.0.1:{PORT}", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
