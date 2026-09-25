#!/usr/bin/env node
// Cross-platform launcher for the speaker sidecar.
//
// npm scripts can't branch on OS, so a bare
// ".venv-voice\Scripts\python.exe" (the Windows venv layout) was the
// only path ever tried — on macOS/Linux, where a venv puts its
// interpreter at ".venv-voice/bin/python", that command doesn't exist
// and npm just reports "command not found", which says nothing about
// what's actually missing. This picks the right layout for the OS
// running it and, if the venv itself hasn't been created yet, says so
// instead of failing on the interpreter lookup.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const venv = path.join(root, ".venv-voice");
const python = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

if (!existsSync(python)) {
  console.error(
    `The speaker sidecar needs a Python environment at .venv-voice — it isn't there yet ` +
      `(looked for ${path.relative(root, python)}).\n\n` +
      `See README.md for what it needs (Python 3.13, torch, NVIDIA NeMo, soundfile, ` +
      `soxr, librosa) — that setup is machine-specific and has to be done once per machine.`
  );
  process.exit(1);
}

const result = spawnSync(python, [path.join(root, "speaker-sidecar/server.py")], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
