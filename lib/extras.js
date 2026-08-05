'use strict';
// The requirement fields that are pass/fail rather than "how fast": OS version,
// DirectX level, disk space, 64-bit. They were already being parsed off the
// store page and thrown away.
//
// Deliberately kept OUT of the weighted percentage. A missing 70 GB of disk is
// a real blocker but it is not a performance signal, and folding it into the
// score would make a perfectly capable PC look slow.

const WIN_WORDS = { xp: 5.1, vista: 6 };

// Lowest Windows version a requirement accepts. "Windows 7/8/10" means 7.
function parseWindowsVersion(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const found = [];
  const re = /(?:windows|win)\s*(11|10|8\.1|8|7|xp|vista)|(?:^|[\s/,])(11|10|8\.1|8|7)(?=\s*(?:\/|,|\s|$))/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const raw = (m[1] || m[2] || '').trim();
    if (!raw) continue;
    const v = raw in WIN_WORDS ? WIN_WORDS[raw] : parseFloat(raw);
    if (isFinite(v)) found.push(v);
  }
  if (found.length === 0) return null;
  return Math.min(...found);
}

function parseDirectX(text) {
  if (!text) return null;
  const m = String(text).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isFinite(v) && v >= 8 && v <= 12 ? v : null;
}

function parseStorageGB(text) {
  if (!text) return null;
  const m = String(text)
    .toLowerCase()
    .match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|tb)/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(',', '.'));
  if (!isFinite(n)) return null;
  if (m[2] === 'mb') n /= 1024;
  if (m[2] === 'tb') n *= 1024;
  return n;
}

function fmtWin(v) {
  if (v == null) return null;
  return `Windows ${v === 8.1 ? '8.1' : v}`;
}

// ok: true / false / null (unknown — never shown as a failure)
function buildExtras(reqBlock, specs) {
  reqBlock = reqBlock || {};
  specs = specs || {};
  const out = [];

  const reqWin = parseWindowsVersion(reqBlock.os);
  if (reqWin != null) {
    const user = specs.windowsVersion;
    out.push({
      key: 'os',
      label: 'SO',
      required: fmtWin(reqWin),
      user: fmtWin(user),
      ok: user == null ? null : user >= reqWin,
    });
  }

  const reqDx = parseDirectX(reqBlock.directx);
  if (reqDx != null) {
    const user = specs.directX;
    out.push({
      key: 'directx',
      label: 'DirectX',
      required: `${reqDx}`,
      user: user == null ? null : `${user}`,
      ok: user == null ? null : user >= reqDx,
      soft: true, // OS-level guidance; the GPU's feature level is the real gate
    });
  }

  const reqGB = parseStorageGB(reqBlock.storage);
  if (reqGB != null) {
    const free = specs.freeDiskGB;
    out.push({
      key: 'storage',
      label: 'Disco',
      required: `${Math.round(reqGB)} GB`,
      user: free == null ? null : `${Math.round(free)} GB livres`,
      ok: free == null ? null : free >= reqGB,
    });
  }

  if (reqBlock.requires64) {
    const is64 = specs.arch ? /64/.test(String(specs.arch)) : null;
    out.push({
      key: 'arch',
      label: '64 bits',
      required: '64 bits',
      user: specs.arch || null,
      ok: is64,
    });
  }

  return out;
}

module.exports = { parseWindowsVersion, parseDirectX, parseStorageGB, buildExtras };
