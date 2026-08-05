'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRequirementsHtml } = require('../lib/steamScraper');

test('mac-only page yields unavailable (never mislabels non-Windows specs)', () => {
  const html = `<div class="game_area_sys_req sysreq_content" data-os="mac">
    <ul class="bb_ul"><li><strong>Processor:</strong> Apple M1</li></ul></div>`;
  const r = parseRequirementsHtml(html);
  assert.equal(r.available, false);
  assert.equal(r.minimum, null);
  assert.equal(r.recommended, null);
});

test('windows-only page with no data-os parses as minimum', () => {
  const html = `<div class="game_area_sys_req sysreq_content"><ul class="bb_ul">
    <li><strong>Minimum:</strong></li>
    <li><strong>OS:</strong> Windows 10</li>
    <li><strong>Processor:</strong> Core i5-9400</li>
    <li><strong>Memory:</strong> 8 GB RAM</li></ul></div>`;
  const r = parseRequirementsHtml(html);
  assert.equal(r.available, true);
  assert.equal(r.minimum.cpu, 'Core i5-9400');
  assert.equal(r.minimum.ram, '8 GB RAM');
  assert.equal(r.minimum.os, 'Windows 10');
});

test('win + mac blocks present: picks the windows block, both columns', () => {
  const html = `
    <div class="game_area_sys_req" data-os="win">
      <div class="game_area_sys_req_leftCol"><ul><li><strong>Processor:</strong> Ryzen 5 1600</li><li><strong>Memory:</strong> 8 GB RAM</li></ul></div>
      <div class="game_area_sys_req_rightCol"><ul><li><strong>Processor:</strong> Ryzen 7 3700X</li><li><strong>Memory:</strong> 16 GB RAM</li></ul></div>
    </div>
    <div class="game_area_sys_req" data-os="mac"><ul><li><strong>Processor:</strong> Apple M1</li></ul></div>`;
  const r = parseRequirementsHtml(html);
  assert.equal(r.available, true);
  assert.equal(r.minimum.cpu, 'Ryzen 5 1600');
  assert.equal(r.recommended.cpu, 'Ryzen 7 3700X');
  assert.equal(r.recommended.ram, '16 GB RAM');
});
