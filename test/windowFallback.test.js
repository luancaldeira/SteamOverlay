'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../lib/windowFallback');

test('parseCsvLine reads quoted tasklist columns', () => {
  const cols = f.parseCsvLine('"steam.exe","12188","Console","1","99.284 K","Running","PC\\user","0:00:30","Dota 2"');
  assert.equal(cols.length, 9);
  assert.equal(cols[0], 'steam.exe');
  assert.equal(cols[8], 'Dota 2');
});

test('titlesFromTasklist reads the last column regardless of locale', () => {
  // pt-BR Windows: headers are translated, column ORDER is not
  const out = f.titlesFromTasklist(
    '"steamwebhelper.exe","1548","Console","1","273.900 K","Running","Lu\\lu","0:00:22","Half-Life 2"\r\n' +
      '"steamwebhelper.exe","14236","Console","1","14.936 K","Running","Lu\\lu","0:00:00","N/A"\r\n'
  );
  assert.deepEqual(out, ['Half-Life 2']);
});

test('titlesFromTasklist drops placeholder and generic titles', () => {
  const out = f.titlesFromTasklist(
    '"steam.exe","1","Console","1","1 K","Running","u","0:00","Sem título"\r\n' +
      '"steam.exe","2","Console","1","1 K","Running","u","0:00","Steam"\r\n' +
      '"steam.exe","3","Console","1","1 K","Running","u","0:00","N/A"\r\n'
  );
  assert.deepEqual(out, []);
});

test('titlesFromTasklist survives the "no tasks" message', () => {
  assert.deepEqual(f.titlesFromTasklist('INFO: No tasks are running which match the specified criteria.'), []);
  assert.deepEqual(f.titlesFromTasklist(''), []);
});

test('isPlausibleMatch rejects a fuzzy search hit that is not the same game', () => {
  assert.equal(f.isPlausibleMatch('Half-Life 2', 'Half-Life 2'), true);
  assert.equal(f.isPlausibleMatch('Half-Life 2', 'Half-Life 2: Episode One'), true); // hit extends the query
  assert.equal(f.isPlausibleMatch('Portal', 'Portal 2'), true);
  assert.equal(f.isPlausibleMatch('Portal', 'Bridge Constructor'), false);
  assert.equal(f.isPlausibleMatch('', 'Portal'), false);
});

test('isPlausibleMatch ignores punctuation and case differences', () => {
  assert.equal(f.isPlausibleMatch('counter-strike 2', 'Counter Strike 2'), true);
});
