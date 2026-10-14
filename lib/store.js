// Tiny JSON-file persistence in ./data (kept local; nothing leaves your machine
// except what you send to TinyFish to do the errand).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.ERRAND_DATA_DIR || 'data');
fs.mkdirSync(path.join(DATA_DIR, 'shots'), { recursive: true });

export function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return fallback; }
}

export function writeJSON(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
