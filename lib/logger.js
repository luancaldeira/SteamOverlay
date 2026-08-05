'use strict';
// Rotating file logger. Replaces the bare `catch {}` blocks that used to hide
// every transient failure. One file, rotated once past MAX_BYTES, so it can
// never grow unbounded on a machine that runs the overlay for months.

const fs = require('fs');
const path = require('path');
const { dataFile } = require('./appPaths');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_BYTES = 512 * 1024;

let level = LEVELS.info;
let filePath = null;
let stream = null;
let failed = false;

function resolveFile() {
  if (filePath) return filePath;
  filePath = dataFile('overlay.log');
  return filePath;
}

function rotate(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
    if (stream) {
      stream.end();
      stream = null;
    }
  } catch {
    /* file missing = nothing to rotate */
  }
}

function ensureStream() {
  if (failed) return null;
  if (stream) return stream;
  try {
    const file = resolveFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      failed = true;
      stream = null;
    });
    return stream;
  } catch {
    failed = true;
    return null;
  }
}

function stamp() {
  return new Date().toISOString();
}

function fmt(arg) {
  if (arg instanceof Error) return `${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function write(lvl, scope, args) {
  if (LEVELS[lvl] > level) return;
  const line = `${stamp()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${args.map(fmt).join(' ')}\n`;
  const s = ensureStream();
  if (s) s.write(line);
  if (lvl === 'error' && process.env.NODE_ENV !== 'test') process.stderr.write(line);
}

function setLevel(name) {
  if (name in LEVELS) level = LEVELS[name];
}

function scoped(scope) {
  return {
    error: (...a) => write('error', scope, a),
    warn: (...a) => write('warn', scope, a),
    info: (...a) => write('info', scope, a),
    debug: (...a) => write('debug', scope, a),
  };
}

function logPath() {
  return resolveFile();
}

module.exports = { scoped, setLevel, logPath, LEVELS };
