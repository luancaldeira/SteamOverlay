'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseRequirementsHtml, parseRequirementsFragment, parseTitleFromHtml } = require('../lib/steamScraper');

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

// ---- appdetails fragments (1.0) ------------------------------------------
const FRAGMENT =
  '<strong>Minimum:</strong><br><ul class="bb_ul">' +
  '<li>Requires a 64-bit processor and operating system<br></li>' +
  '<li><strong>OS:</strong> 64-bit Windows 10<br></li>' +
  '<li><strong>Processor:</strong> Core i7-6700 or Ryzen 5 1600<br></li>' +
  '<li><strong>Memory:</strong> 12 GB RAM<br></li>' +
  '<li><strong>Graphics:</strong> GeForce GTX 1060 6GB<br></li>' +
  '<li><strong>DirectX:</strong> Version 12<br></li>' +
  '<li><strong>Storage:</strong> 70 GB available space<br></li>' +
  '<li><strong>Additional Notes:</strong> SSD required.</li></ul>';

test('parseRequirementsFragment reads every mapped label', () => {
  const b = parseRequirementsFragment(FRAGMENT);
  assert.equal(b.os, '64-bit Windows 10');
  assert.equal(b.cpu, 'Core i7-6700 or Ryzen 5 1600');
  assert.equal(b.ram, '12 GB RAM');
  assert.equal(b.gpu, 'GeForce GTX 1060 6GB');
  assert.equal(b.directx, 'Version 12');
  assert.equal(b.storage, '70 GB available space');
  assert.equal(b.notes, 'SSD required.');
});

test('parseRequirementsFragment keeps un-labelled lines and flags 64-bit', () => {
  const b = parseRequirementsFragment(FRAGMENT);
  assert.equal(b.requires64, true);
  assert.match(b.extra, /64-bit processor/);
});

test('parseRequirementsFragment returns null for empty input', () => {
  assert.equal(parseRequirementsFragment(''), null);
  assert.equal(parseRequirementsFragment(null), null);
  assert.equal(parseRequirementsFragment('<strong>Minimum:</strong>'), null);
});

test('a block with only notes is not a requirements block', () => {
  const b = parseRequirementsFragment(
    '<ul><li><strong>Additional Notes:</strong> Controller recommended.</li></ul>'
  );
  assert.equal(b, null);
});

test('parseTitleFromHtml reads the store page heading', () => {
  assert.equal(parseTitleFromHtml('<div id="appHubAppName">Portal 2</div>'), 'Portal 2');
  assert.equal(parseTitleFromHtml('<div>nothing</div>'), null);
});
