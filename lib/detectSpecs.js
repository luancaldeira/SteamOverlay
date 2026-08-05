'use strict';
// Detect the machine's real CPU / GPU / RAM once and cache it.
// Prefers a dedicated GPU (most VRAM, non-integrated) over an iGPU.

const si = require('systeminformation');

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

async function detectSpecs() {
  if (cached) return cached;
  const out = {
    cpu: null,
    cpuRaw: null,
    cpuCores: null, // physical cores
    cpuThreads: null, // logical processors
    cpuGHz: null, // max/base clock
    gpu: null,
    gpuVramMB: null,
    ramGB: null,
    error: null,
  };
  try {
    const [cpu, graphics, mem] = await Promise.all([si.cpu(), si.graphics(), si.mem()]);
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
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
  }
  cached = out;
  return out;
}

function _reset() {
  cached = null;
}

module.exports = { detectSpecs, pickGpu, _reset };
