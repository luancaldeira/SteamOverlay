'use strict';
// Detect the machine's real CPU / GPU / RAM / OS / free space once and cache it,
// on disk as well as in memory so a relaunch paints immediately instead of
// waiting on WMI again.
// Prefers a dedicated GPU (most VRAM, non-integrated) over an iGPU.

const si = require('systeminformation');
const cache = require('./cache');
const log = require('./logger').scoped('specs');

const NS = 'specs';
const KEY = 'machine';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // hardware rarely changes; a week is plenty

let cached = null;

function pickGpu(controllers) {
  if (!controllers || controllers.length === 0) return { model: null, vendor: null, vramMB: null };
  const scored = controllers.map((c) => {
    const vram = Number(c.vram) || 0; // MB
    const vendor = (c.vendor || '').toLowerCase();
    const model = (c.model || '').toLowerCase();
    const integrated =
      /intel/.test(vendor) ||
      /uhd|hd graphics|iris|radeon graphics|integrated/.test(model) ||
      (/\bvega \d/.test(model) && !/\brx vega/.test(model)); // APU Vega, not dedicated RX Vega
    // dedicated + more VRAM ranks higher
    const rank = (integrated ? 0 : 1000000) + vram;
    return { c, vram, rank };
  });
  scored.sort((a, b) => b.rank - a.rank);
  const best = scored[0].c;
  return {
    model: best.model || null,
    vendor: best.vendor || null,
    vramMB: Number(best.vram) || null,
  };
}

// Windows major version as a comparable number. 8.1 sorts between 8 and 10.
function windowsVersionFrom(distro, release) {
  const src = `${distro || ''} ${release || ''}`;
  const m = src.match(/windows\s+(11|10|8\.1|8|7|xp|vista)/i);
  if (m) {
    const v = m[1].toLowerCase();
    if (v === 'xp') return 5.1;
    if (v === 'vista') return 6;
    return parseFloat(v);
  }
  // Windows 11 reports itself as 10.0.x — the build number is the only tell.
  const b = String(release || '').match(/10\.0\.(\d+)/);
  if (b) return Number(b[1]) >= 22000 ? 11 : 10;
  return null;
}

// DirectX level the OS can expose. Real feature level also depends on the GPU,
// so this is reported as guidance, never as a hard fail.
function directXForWindows(v) {
  if (v == null) return null;
  if (v >= 10) return 12;
  if (v >= 8.1) return 11.2;
  if (v >= 8) return 11.1;
  if (v >= 7) return 11;
  return 9;
}

// Free space on the drive Windows is installed on — the one a game's "70 GB
// available space" line is really talking about for a default install.
function pickSystemDisk(fsList) {
  if (!Array.isArray(fsList) || fsList.length === 0) return null;
  const sysLetter = (process.env.SystemDrive || 'C:').toUpperCase();
  const match =
    fsList.find((f) => String(f.mount || '').toUpperCase().startsWith(sysLetter)) || fsList[0];
  if (!match) return null;
  const free = Number(match.available != null ? match.available : match.size - match.used);
  return isFinite(free) && free > 0 ? free / 1024 ** 3 : null;
}

function cleanDeviceName(name) {
  if (!name) return null;
  return (
    String(name)
      .replace(/\(R\)|\(TM\)|\(C\)|®|™|©/gi, '')
      .replace(/\b(Advanced Micro Devices|NVIDIA Corporation|Intel Corporation)\s*,?\s*/gi, '')
      .replace(/\bInc\.?\s*,?\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .trim() || null
  );
}

async function probe() {
  const out = {
    cpu: null,
    cpuRaw: null,
    cpuCores: null, // physical cores
    cpuThreads: null, // logical processors
    cpuGHz: null, // max/base clock
    gpu: null,
    gpuVramMB: null,
    ramGB: null,
    osName: null,
    osRelease: null,
    windowsVersion: null,
    directX: null,
    arch: null,
    freeDiskGB: null,
    error: null,
  };
  try {
    const [cpu, graphics, mem, os, fs] = await Promise.all([
      si.cpu(),
      si.graphics(),
      si.mem(),
      si.osInfo().catch(() => null),
      si.fsSize().catch(() => null),
    ]);
    const manu = (cpu.manufacturer || '').trim();
    const brand = (cpu.brand || '').trim();
    // "Intel Core i7-6700" — avoid duplicating manufacturer if already in brand
    out.cpuRaw = { manufacturer: manu, brand };
    out.cpu = brand.toLowerCase().includes(manu.toLowerCase()) || !manu ? brand : `${manu} ${brand}`;
    out.cpuCores = Number(cpu.physicalCores) || Number(cpu.cores) || null;
    out.cpuThreads = Number(cpu.cores) || out.cpuCores; // si `cores` = logical count
    out.cpuGHz = parseFloat(cpu.speedMax || cpu.speed) || null;

    const g = pickGpu(graphics.controllers);
    out.gpu = [g.vendor, g.model].filter(Boolean).join(' ').trim() || g.model || null;
    out.gpuVramMB = g.vramMB;

    out.ramGB = mem.total ? Math.round(mem.total / 1024 ** 3) : null;

    if (os) {
      out.osName = os.distro || null;
      out.osRelease = os.release || null;
      out.arch = os.arch || process.arch;
      out.windowsVersion = windowsVersionFrom(os.distro, os.release);
      out.directX = directXForWindows(out.windowsVersion);
    } else {
      out.arch = process.arch;
    }
    out.freeDiskGB = pickSystemDisk(fs);
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
    log.error('spec detection failed', e);
  }
  out.cpuDisplay = cleanDeviceName(out.cpu);
  out.gpuDisplay = cleanDeviceName(out.gpu);
  return out;
}

// Disk-cached so the second launch has specs before the window even paints.
// Free disk space is the one volatile field, so it is refreshed in the
// background on every start without blocking.
async function detectSpecs() {
  if (cached) return cached;
  const stored = cache.get(NS, KEY, TTL_MS);
  if (stored && stored.cpu) {
    cached = stored;
    refreshDiskSpace();
    return cached;
  }
  cached = await probe();
  if (!cached.error) cache.set(NS, KEY, cached, { limit: 4 });
  return cached;
}

function refreshDiskSpace() {
  si.fsSize()
    .then((fs) => {
      const free = pickSystemDisk(fs);
      if (free != null && cached) {
        cached.freeDiskGB = free;
        cache.set(NS, KEY, cached, { limit: 4 });
      }
    })
    .catch(() => {
      /* stale value is fine */
    });
}

function _reset() {
  cached = null;
}

module.exports = {
  detectSpecs,
  probe,
  pickGpu,
  pickSystemDisk,
  windowsVersionFrom,
  directXForWindows,
  cleanDeviceName,
  _reset,
};
