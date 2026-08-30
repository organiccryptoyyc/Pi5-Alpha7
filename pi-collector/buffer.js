// buffer.js -- local durability layer. Plain NDJSON on disk, no DB engine.
//
// Why NDJSON instead of SQLite: this repo's own project (alpha1) deliberately
// avoided native-compile dependencies on Alpine before (see its HEIC route,
// which picked a pure-JS/WASM lib specifically to dodge that); the Pi's a
// residential ARM box with the same incentive to keep the dependency graph at
// zero. At tens of measurements per minute, appending lines and filtering them
// in memory is plenty fast, and there's nothing here a real DB would do better.

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function appendMeasurements(bufferFile, records) {
  if (records.length === 0) return;
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(bufferFile, lines, "utf8");
}

/**
 * Atomically hand off whatever's in bufferFile to tmpFile so new probe results
 * can keep appending to a fresh bufferFile while the old contents are sent.
 * A rename is atomic on the same filesystem -- no window where a measurement
 * is lost or duplicated between "still buffering" and "being sent".
 */
export async function rotateForSending(bufferFile, tmpFile) {
  if (existsSync(tmpFile)) return true; // previous send still pending -- don't clobber it
  if (!existsSync(bufferFile)) return false;
  await rename(bufferFile, tmpFile);
  return true;
}

export async function readRecords(file) {
  if (!existsSync(file)) return [];
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null; // one corrupt line (e.g. a torn write after a power loss) never sinks the batch
      }
    })
    .filter(Boolean);
}

export async function writeRecords(file, records) {
  if (records.length === 0) {
    await rm(file, { force: true });
    return;
  }
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(file, lines, "utf8");
}

export async function clearFile(file) {
  await rm(file, { force: true });
}
