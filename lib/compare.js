'use strict';
// Pure comparison logic: match free-text requirement against internal benchmark
// tables, turn ratios into 0-100 component scores, weight into a block score.
// No I/O here except the optional loadTables() convenience helper.

const path = require('path');

const MANUFACTURER_PREFIXES = ['intel ', 'amd ', 'nvidia ', 'geforce ', 'radeon '];
const MIN_FORM_LEN = 4;

const WEIGHTS = { gpu: 0.45, cpu: 0.35, ram: 0.20 };

function normalize(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/[-_]/g, ' ') // separator-insensitive: "i5-750" == "i5 750"
    .replace(/\s+/g, ' ')
    .trim();
}

// Candidate substrings for a table key: the full key plus progressively
// prefix-stripped forms, so "geforce gtx 1060" also matches text "gtx 1060".
function candidateForms(key) {
  const forms = [key];
  let k = key;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of MANUFACTURER_PREFIXES) {
      if (k.startsWith(p)) {
        k = k.slice(p.length);
        forms.push(k);
        changed = true;
        break;
      }
    }
  }
  return forms;
}

// Substring match that respects numeric boundaries, so a model number is not
// matched inside a longer one (e.g. "rx 580" must NOT match inside "rx 5800").
// A digit adjacent to a digit-ending/starting form means it's a different number.
function includesBounded(t, form) {
  let idx = t.indexOf(form);
  const startsDigit = /\d/.test(form[0]);
  const endsDigit = /\d/.test(form[form.length - 1]);
  while (idx !== -1) {
    const before = idx > 0 ? t[idx - 1] : '';
    const after = idx + form.length < t.length ? t[idx + form.length] : '';
    const beforeOk = !(startsDigit && /\d/.test(before));
    const afterOk = !(endsDigit && /\d/.test(after));
    if (beforeOk && afterOk) return true;
    idx = t.indexOf(form, idx + 1);
  }
  return false;
}

// Find the best table entry inside free requirement text.
// Longest matched form wins (so "i5-9400" beats a bare "i5").
function matchScore(text, scores) {
  const t = normalize(text);
  if (!t) return null;
  let best = null;
  for (const [key, score] of Object.entries(scores)) {
    // normalize the key the same way as the text (hyphen-insensitive) but keep
    // the original key string for display
    for (const form of candidateForms(normalize(key))) {
      if (form.length < MIN_FORM_LEN) continue;
      if (includesBounded(t, form)) {
        if (!best || form.length > best.matchLen) {
          best = { key, score, matchLen: form.length };
        }
        break; // full key is first, so first hit is this key's longest form
      }
    }
  }
  return best ? { key: best.key, score: best.score } : null;
}

// Map a performance ratio (user / required) onto 0-100 per PRD 3.3 curve.
function scoreFromRatio(ratio) {
  if (!isFinite(ratio) || ratio <= 0) return 0;
  let s;
  if (ratio >= 1.4) s = 100;
  else if (ratio >= 1.0) s = 70 + ((ratio - 1.0) / 0.4) * 30;
  else if (ratio >= 0.7) s = 40 + ((ratio - 0.7) / 0.3) * 30;
  else s = (ratio / 0.7) * 40;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function parseRamGB(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb)/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(n)) return null;
  if (m[2].toLowerCase() === 'mb') n = n / 1024;
  return n;
}

function compareBench(userText, reqText, scores) {
  const reqM = matchScore(reqText, scores);
  if (!reqM) {
    return { identified: false, reason: 'requirement-unmatched', required: reqText || null };
  }
  const userM = matchScore(userText, scores);
  if (!userM) {
    return { identified: false, reason: 'user-unmatched', required: reqText || null, requiredMatch: reqM.key };
  }
  const ratio = userM.score / reqM.score;
  return {
    identified: true,
    required: reqText || null,
    requiredMatch: reqM.key,
    userMatch: userM.key,
    reqScore: reqM.score,
    userScore: userM.score,
    ratio,
    score: scoreFromRatio(ratio),
  };
}

// Steam requirements are often generic ("4 hardware CPU threads",
// "Quad-core 2.5 GHz", "Dual core from Intel or AMD") with no matchable model.
// Pull whatever structured signal exists.
const WORD_CORES = {
  single: 1,
  dual: 2,
  two: 2,
  triple: 3,
  three: 3,
  quad: 4,
  four: 4,
  penta: 5,
  hexa: 6,
  hex: 6,
  six: 6,
  octa: 8,
  octo: 8,
  eight: 8,
};

function parseGenericCpu(text) {
  if (!text) return null;
  const t = normalize(text);
  let threads = null;
  let cores = null;
  let ghz = null;
  let m;
  if ((m = t.match(/(\d+)\s*(?:hardware\s*)?(?:cpu\s*)?threads?/))) threads = parseInt(m[1], 10);
  if ((m = t.match(/(\d+)\s*(?:physical\s*)?cores?/))) cores = parseInt(m[1], 10);
  else {
    for (const [w, n] of Object.entries(WORD_CORES)) {
      if (new RegExp(`\\b${w}\\s*core`).test(t)) {
        cores = n;
        break;
      }
    }
  }
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*ghz/))) ghz = parseFloat(m[1]);
  if (threads == null && cores == null && ghz == null) return null;
  return { threads, cores, ghz };
}

// Compare the user's real core/thread/clock counts against a generic requirement.
function compareCpuGeneric(user, req) {
  const ratios = [];
  const parts = [];
  // thread count is the strongest signal; fall back to core count
  if (req.threads && user.threads) {
    ratios.push(user.threads / req.threads);
    parts.push(`${req.threads} threads`);
  } else if (req.cores && user.cores) {
    ratios.push(user.cores / req.cores);
    parts.push(`${req.cores} núcleos`);
  }
  if (req.ghz && user.ghz) {
    ratios.push(user.ghz / req.ghz);
    parts.push(`${req.ghz} GHz`);
  }
  if (ratios.length === 0) return null;
  const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return { score: scoreFromRatio(ratio), ratio, parts };
}

// CPU comparison: try an exact benchmark-model match first, then fall back to a
// generic core/thread/GHz comparison for ambiguous Steam requirement strings.
function compareCpu(specs, reqText, scores) {
  const model = compareBench(specs.cpu, reqText, scores);
  if (model.identified) return { ...model, method: 'model' };

  const req = parseGenericCpu(reqText);
  const user = { threads: specs.cpuThreads, cores: specs.cpuCores, ghz: specs.cpuGHz };
  if (req && (user.threads || user.cores || user.ghz)) {
    const g = compareCpuGeneric(user, req);
    if (g) {
      const uParts = [];
      if (user.threads) uParts.push(`${user.threads}T`);
      if (user.ghz) uParts.push(`${user.ghz}GHz`);
      return {
        identified: true,
        method: 'generic',
        required: reqText || null,
        requiredMatch: g.parts.join(' + '),
        userMatch: uParts.join(' / ') || 'seu CPU',
        score: g.score,
        ratio: g.ratio,
      };
    }
  }
  return model; // unidentified — carries the model reason
}

function compareRam(userGB, reqText) {
  const reqGB = parseRamGB(reqText);
  if (!reqGB || !userGB) {
    return { identified: false, reason: reqGB ? 'user-unknown' : 'requirement-unmatched', requiredGB: reqGB || null, userGB: userGB || null };
  }
  const ratio = userGB / reqGB;
  return { identified: true, requiredGB: reqGB, userGB, ratio, score: scoreFromRatio(ratio) };
}

function verdictFor(overall) {
  if (overall == null) return 'não foi possível estimar';
  if (overall >= 85) return 'roda tranquilo';
  if (overall >= 65) return 'deve rodar bem';
  if (overall >= 45) return 'no limite, espere quedas / baixar gráficos';
  return 'abaixo do requisito';
}

// reqBlock: { cpu, gpu, ram } free-text fields from the store page.
// specs: { cpu, gpu, ramGB }.
// tables: { cpu: {scores}, gpu: {scores} }.
function compareBlock(reqBlock, specs, tables) {
  reqBlock = reqBlock || {};
  const components = {
    gpu: compareBench(specs.gpu, reqBlock.gpu, tables.gpu.scores || tables.gpu),
    cpu: compareCpu(specs, reqBlock.cpu, tables.cpu.scores || tables.cpu),
    ram: compareRam(specs.ramGB, reqBlock.ram),
  };
  const parts = [
    { key: 'gpu', c: components.gpu },
    { key: 'cpu', c: components.cpu },
    { key: 'ram', c: components.ram },
  ].filter((p) => p.c.identified);

  let overall = null;
  if (parts.length > 0) {
    const wsum = parts.reduce((s, p) => s + WEIGHTS[p.key], 0);
    const acc = parts.reduce((s, p) => s + p.c.score * WEIGHTS[p.key], 0);
    overall = Math.round(acc / wsum);
  }
  return { overall, verdict: verdictFor(overall), components };
}

// requirements: { minimum: reqBlock, recommended: reqBlock, available: bool }
function compare(specs, requirements, tables) {
  const out = { minimum: null, recommended: null };
  if (requirements && requirements.minimum) out.minimum = compareBlock(requirements.minimum, specs, tables);
  if (requirements && requirements.recommended) out.recommended = compareBlock(requirements.recommended, specs, tables);
  return out;
}

function loadTables() {
  return {
    cpu: require(path.join(__dirname, '..', 'data', 'cpu-benchmarks.json')),
    gpu: require(path.join(__dirname, '..', 'data', 'gpu-benchmarks.json')),
  };
}

module.exports = {
  normalize,
  candidateForms,
  includesBounded,
  matchScore,
  scoreFromRatio,
  parseRamGB,
  parseGenericCpu,
  compareCpuGeneric,
  compareCpu,
  compareBench,
  compareRam,
  compareBlock,
  compare,
  verdictFor,
  loadTables,
  WEIGHTS,
};
