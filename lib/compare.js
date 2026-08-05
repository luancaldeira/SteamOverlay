'use strict';
// Pure comparison logic: match free-text requirement against internal benchmark
// tables, turn ratios into 0-100 component scores, weight into a block score.
// No I/O here except the optional loadTables() convenience helper.
//
// Two rules drive most of the accuracy:
//   * a requirement listing alternatives ("GTX 1060 or RX 580 or Arc A380") is
//     satisfied by the WEAKEST of them, so the requirement score is the minimum
//     across alternatives — not whichever model name happens to be longest;
//   * a model missing from the table is estimated by interpolating between its
//     neighbours in the same family and generation, instead of being dropped.

const path = require('path');

const MANUFACTURER_PREFIXES = ['intel ', 'amd ', 'nvidia ', 'geforce ', 'radeon '];
const MIN_FORM_LEN = 4;

const WEIGHTS = { gpu: 0.45, cpu: 0.35, ram: 0.20 };

// Vendor boilerplate that Windows/WMI bakes into device names and that no
// requirement string ever contains.
const VENDOR_NOISE =
  /\b(advanced micro devices|micro devices|nvidia corporation|intel corporation|corporation|corp|incorporated|inc|ltd|llc|co|tm|r|c)\b/g;

function normalize(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\((?:r|tm|c)\)/g, ' ') // "(R)", "(TM)" written out in ASCII
    .replace(/[()]/g, ' ')
    .replace(/[-_]/g, ' ') // separator-insensitive: "i5-750" == "i5 750"
    .replace(/,/g, ' , ') // keep commas as their own token for segmentation
    // Old requirement strings glue the family to the number ("HD2600", "GTX1060")
    // or the number to the variant ("9600GT", "6600XT"). Split both so a single
    // spelling of each key matches every way Steam writes it.
    .replace(/\b(gtx|rtx|gts|gt|hd|rx)(\d)/g, '$1 $2')
    .replace(/(\d)(ti|gts|gtx|gt|xtx|xt|gre|super|m)\b/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Device names only. Requirement text is left alone — stripping "intel" there
// could turn "Intel HD 4000" into something unrecognizable.
function normalizeDevice(str) {
  return normalize(str)
    .replace(VENDOR_NOISE, ' ')
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

// ---- model family parsing / estimation ----------------------------------
// Used only when a model is absent from the table. Recognising the family and
// generation lets us place an unknown SKU between its known neighbours rather
// than throwing the whole component away.

// The model number is NOT anchored with \b on its right: real SKUs glue their
// suffix straight onto the digits ("9400f", "5600x3d", "13600k") and a trailing
// \b would reject every one of them.
const GPU_FAMILIES = [
  { re: /\b(?:geforce\s+)?rtx\s*(\d{4})/, fam: 'nv-rtx' },
  { re: /\b(?:geforce\s+)?gtx\s*(\d{3,4})/, fam: 'nv-gtx' },
  { re: /\b(?:geforce\s+)?gt\s*(\d{3,4})/, fam: 'nv-gt' },
  { re: /\b(?:radeon\s+)?rx\s*(\d{3,4})/, fam: 'amd-rx' },
  { re: /\b(?:radeon\s+)?hd\s*(\d{4})/, fam: 'amd-hd' },
  { re: /\br([579])\s+(\d{3})/, fam: 'amd-r', joinGroups: true },
  { re: /\barc\s+([ab])\s*(\d{3})/, fam: 'intel-arc', letterGroup: true },
];

const CPU_FAMILIES = [
  { re: /\bcore\s+ultra\s+([3579])\s+(\d{3})/, fam: 'intel-ultra', tierGroup: true },
  { re: /\bi([3579])\s*(\d{3,5})/, fam: 'intel-core', tierGroup: true },
  { re: /\bryzen\s+(?:ai\s+)?([3579])\s+(\d{3,4})/, fam: 'amd-ryzen', tierGroup: true },
  { re: /\bfx\s*(\d{4})/, fam: 'amd-fx' },
];

// Parts that share a model number but not a performance class must not land in
// the same interpolation bucket: a GTX 960M is half a GTX 960, a Ryzen 3 3200G
// is a previous-gen APU next to a Ryzen 3 3100, and a 5825U is a 15 W chip
// beside a 45 W 5800H.
function variantTag(fam, tail, whole) {
  if (MOBILE_RE.test(whole)) return '-mobile';
  if (fam.startsWith('nv-') && /^m\b/.test(tail)) return '-mobile';
  if (fam.startsWith('amd-rx') && /^[ms]\b/.test(tail)) return '-mobile';
  if (fam.startsWith('amd-ryzen')) {
    if (/^(hx|hs|hq|h)\b/.test(tail)) return '-mobh';
    if (/^u\b/.test(tail)) return '-mobu';
    if (/^gt?\b/.test(tail)) return '-apu';
  }
  if (fam.startsWith('intel-core') || fam.startsWith('intel-ultra')) {
    if (/^(hx|hs|hq|h)\b/.test(tail)) return '-mobh';
    if (/^(u|g\d)\b/.test(tail)) return '-mobu';
  }
  return '';
}

// Ranks below 10 so they order variants *within* a model number without ever
// leapfrogging the next model number up (effRank = number * 10 + bonus).
const SUFFIX_BONUS = [
  [/\bti\s+super\b/, 7],
  [/\bxtx\b/, 7],
  [/\bx3d\b/, 6],
  [/\bti\b/, 5],
  [/\bxt\b/, 5],
  [/\bks\b/, 4],
  [/\bsuper\b/, 3],
  [/\bkf?\b/, 3],
  [/\bxf?\b/, 3],
  [/\bgre\b/, 2],
  [/\bs\b/, 1],
  [/\bge?\b/, -2],
  [/\bt\b/, -2],
];

const MOBILE_RE = /\b(laptop|mobile|max\s*q|notebook)\b/;

function suffixBonus(tail) {
  for (const [re, bonus] of SUFFIX_BONUS) if (re.test(tail)) return bonus;
  return 0;
}

// -> { fam, gen, effRank } or null
function parseModel(text, families) {
  const t = normalize(text);
  if (!t) return null;
  for (const f of families) {
    const m = t.match(f.re);
    if (!m) continue;
    let num;
    let famKey = f.fam;
    if (f.joinGroups) {
      famKey = `${f.fam}${m[1]}`;
      num = parseInt(m[2], 10);
    } else if (f.letterGroup) {
      famKey = `${f.fam}-${m[1]}`;
      num = parseInt(m[2], 10);
    } else if (f.tierGroup) {
      famKey = `${f.fam}${m[1]}`;
      num = parseInt(m[2], 10);
    } else {
      num = parseInt(m[1], 10);
    }
    if (!isFinite(num)) continue;
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 16).trim();
    famKey += variantTag(famKey, tail, t);
    return { fam: famKey, gen: generationOf(famKey, num), effRank: num * 10 + suffixBonus(tail) };
  }
  return null;
}

// Group models that compete with each other. Mixing an RTX 2060 into the RTX 40
// interpolation would produce nonsense, so generation is part of the bucket.
//
// Digit count is part of the bucket id because families reuse numbers across
// eras: RX 590 and RX 5300 are unrelated cards that both start with a 5.
function generationOf(fam, num) {
  const digits = String(num).length;
  let group;
  if (fam.startsWith('nv-gtx') || fam.startsWith('nv-gt')) {
    group = Math.floor(num / 100); // 1050 -> 10, 1660 -> 16, 750 -> 7
  } else if (fam.startsWith('intel-core')) {
    group = digits >= 4 ? Math.floor(num / 1000) : 0; // 13600 -> 13, 9400 -> 9, 750 -> 1st gen
  } else if (
    fam.startsWith('intel-ultra') ||
    fam.startsWith('intel-arc') ||
    fam.startsWith('amd-r5') ||
    fam.startsWith('amd-r7') ||
    fam.startsWith('amd-r9')
  ) {
    group = Math.floor(num / 100); // R7 265 -> 2, R7 340 -> 3, Arc A750 -> 7
  } else {
    group = num >= 1000 ? Math.floor(num / 1000) : Math.floor(num / 100);
  }
  return `${digits}:${group}`;
}

const indexCache = new WeakMap();

function familyIndex(scores, families) {
  const hit = indexCache.get(scores);
  if (hit) return hit;
  const idx = new Map(); // `${fam}|${gen}` -> sorted [{effRank, score, key}]
  for (const [key, score] of Object.entries(scores)) {
    const sig = parseModel(key, families);
    if (!sig) continue;
    const bucket = `${sig.fam}|${sig.gen}`;
    if (!idx.has(bucket)) idx.set(bucket, []);
    idx.get(bucket).push({ effRank: sig.effRank, score, key });
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.effRank - b.effRank);
  indexCache.set(scores, idx);
  return idx;
}

// Estimate a score for a model that is not in the table by interpolating
// between its in-table neighbours. Never extrapolates past the ends of the
// bucket — beyond the edges it clamps to the nearest known part.
function estimate(text, scores, families) {
  const sig = parseModel(text, families);
  if (!sig) return null;
  const arr = familyIndex(scores, families).get(`${sig.fam}|${sig.gen}`);
  if (!arr || arr.length === 0) return null;

  if (sig.effRank <= arr[0].effRank) {
    return { score: arr[0].score, basedOn: arr[0].key, approx: true };
  }
  const last = arr[arr.length - 1];
  if (sig.effRank >= last.effRank) {
    return { score: last.score, basedOn: last.key, approx: true };
  }
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i];
    const b = arr[i + 1];
    if (sig.effRank >= a.effRank && sig.effRank <= b.effRank) {
      const span = b.effRank - a.effRank || 1;
      const w = (sig.effRank - a.effRank) / span;
      return {
        score: Math.round(a.score + (b.score - a.score) * w),
        basedOn: `${a.key} / ${b.key}`,
        approx: true,
      };
    }
  }
  return null;
}

// ---- requirement text segmentation --------------------------------------
// "GTX 1060 or RX 580 or Arc A380" — any one of them satisfies the game, so the
// effective requirement is the cheapest alternative.

const ALT_SPLIT = /\s+(?:or|ou|oder|\/|\||,|;)\s+|\s*[/|;]\s*|\s+,\s+/;
const NEGATION_RE = /\b(not supported|unsupported|not compatible|will not|won t|nao suportad|não suportad|excluded|incompatible)\b/;

function splitAlternatives(text) {
  const t = normalize(text);
  if (!t) return [];
  return t
    .split(ALT_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Requirements often disqualify a part in a parenthetical: "Radeon RX 580
// (Intel UHD Graphics 630 not supported)". Dropping the whole bracketed clause
// is what keeps the weakest-alternative rule from picking the excluded card.
function stripNegated(text) {
  const drop = (m) => (NEGATION_RE.test(m.toLowerCase()) ? ' ' : m);
  return String(text).replace(/\([^)]*\)/g, drop).replace(/\[[^\]]*\]/g, drop);
}

// Requirement-side matching: weakest alternative wins.
function matchRequirement(text, scores, families) {
  if (!text) return null;
  text = stripNegated(text);
  const segments = splitAlternatives(text);
  const hits = [];
  for (const seg of segments) {
    if (NEGATION_RE.test(seg)) continue;
    const m = matchScore(seg, scores);
    if (m) hits.push({ ...m, approx: false });
  }
  if (hits.length > 0) {
    hits.sort((a, b) => a.score - b.score);
    return {
      key: hits[0].key,
      score: hits[0].score,
      approx: false,
      alternatives: hits.map((h) => h.key),
    };
  }
  // Nothing matched segment-by-segment — a model name may straddle a separator.
  const whole = matchScore(text, scores);
  if (whole) return { ...whole, approx: false, alternatives: [whole.key] };

  if (!families) return null;
  const est = [];
  for (const seg of segments) {
    if (NEGATION_RE.test(seg)) continue;
    const e = estimate(seg, scores, families);
    if (e) est.push(e);
  }
  if (est.length === 0) return null;
  est.sort((a, b) => a.score - b.score);
  return {
    key: est[0].basedOn,
    score: est[0].score,
    approx: true,
    alternatives: est.map((e) => e.basedOn),
  };
}

// User-side matching: one physical device, so the longest/most specific match
// wins; only if the table has nothing do we estimate.
function matchUser(text, scores, families) {
  if (!text) return null;
  const device = normalizeDevice(text);
  const m = matchScore(device, scores) || matchScore(text, scores);
  if (m) return { ...m, approx: false };
  if (!families) return null;
  const e = estimate(device, scores, families);
  return e ? { key: e.basedOn, score: e.score, approx: true } : null;
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

// VRAM asked for by a GPU requirement line. With alternatives listed, the
// smallest figure is the real bar (same "or" logic as the model match).
function parseVramGB(text) {
  if (!text) return null;
  const t = normalize(text);
  const found = [];
  const re = /(\d+(?:\.\d+)?)\s*(gb|mb)\b/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    let n = parseFloat(m[1]);
    if (!isFinite(n)) continue;
    if (m[2] === 'mb') n /= 1024;
    if (n >= 0.5 && n <= 48) found.push(n);
  }
  if (found.length === 0) return null;
  return Math.min(...found);
}

function compareBench(userText, reqText, scores, families) {
  const reqM = matchRequirement(reqText, scores, families);
  if (!reqM) {
    return { identified: false, reason: 'requirement-unmatched', required: reqText || null };
  }
  const userM = matchUser(userText, scores, families);
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
    alternatives: reqM.alternatives || null,
    approx: !!(reqM.approx || userM.approx),
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
  const model = compareBench(specs.cpu, reqText, scores, CPU_FAMILIES);
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
        approx: true,
      };
    }
  }
  return model; // unidentified — carries the model reason
}

// GPU comparison plus the VRAM gate: a card that beats the required chip on raw
// throughput still cannot run a game that demands more VRAM than it has.
function compareGpu(specs, reqText, scores) {
  const base = compareBench(specs.gpu, reqText, scores, GPU_FAMILIES);
  const requiredGB = parseVramGB(reqText);
  const userGB = specs.gpuVramMB ? specs.gpuVramMB / 1024 : null;
  if (!requiredGB || !userGB) return base;

  const vram = {
    requiredGB: Math.round(requiredGB * 10) / 10,
    userGB: Math.round(userGB * 10) / 10,
    ok: userGB + 0.2 >= requiredGB, // rounding slack: a "6 GB" card reports 6.0
  };
  if (!base.identified) return { ...base, vram };
  if (vram.ok) return { ...base, vram };

  const vramScore = scoreFromRatio(userGB / requiredGB);
  return {
    ...base,
    vram,
    score: Math.min(base.score, vramScore),
    vramCapped: vramScore < base.score,
  };
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
  const gpuScores = tables.gpu.scores || tables.gpu;
  const cpuScores = tables.cpu.scores || tables.cpu;
  const components = {
    gpu: compareGpu(specs, reqBlock.gpu, gpuScores),
    cpu: compareCpu(specs, reqBlock.cpu, cpuScores),
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
  const approx = parts.some((p) => p.c.approx);
  return { overall, verdict: verdictFor(overall), approx, components };
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
  normalizeDevice,
  candidateForms,
  includesBounded,
  matchScore,
  matchRequirement,
  matchUser,
  splitAlternatives,
  parseModel,
  estimate,
  scoreFromRatio,
  parseRamGB,
  parseVramGB,
  parseGenericCpu,
  compareCpuGeneric,
  compareCpu,
  compareGpu,
  compareBench,
  compareRam,
  compareBlock,
  compare,
  verdictFor,
  loadTables,
  WEIGHTS,
  GPU_FAMILIES,
  CPU_FAMILIES,
};
