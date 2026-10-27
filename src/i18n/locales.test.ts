import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { flatten, languageFromSystem, placeholders, resolveLanguage } from './languages.ts';

const load = (name: string) => flatten(JSON.parse(readFileSync(new URL(`./locales/${name}.json`, import.meta.url), 'utf8')));
const es = load('es');
const en = load('en');

describe('locales', () => {
  test('en.json has exactly the keys of es.json (run scripts/translate-locale.mjs after adding texts)', () => {
    assert.deepEqual(Object.keys(en).filter((key) => !(key in es)), [], 'keys only in en.json');
    assert.deepEqual(Object.keys(es).filter((key) => !(key in en)), [], 'keys missing from en.json');
  });

  test('every translation keeps the same {{placeholders}}', () => {
    const broken = Object.keys(es).filter((key) => placeholders(es[key]).join() !== placeholders(en[key] ?? '').join());
    assert.deepEqual(broken, []);
  });

  test('no empty texts', () => {
    assert.deepEqual([...Object.entries(es), ...Object.entries(en)].filter(([, text]) => !text.trim()).map(([key]) => key), []);
  });
});

describe('language preference', () => {
  test('"system" follows the phone: Spanish stays Spanish, other languages get English, unknown gets Spanish', () => {
    assert.equal(languageFromSystem('es'), 'es');
    assert.equal(languageFromSystem('es-419'), 'es');
    assert.equal(languageFromSystem('en'), 'en');
    assert.equal(languageFromSystem('pt'), 'en');
    assert.equal(languageFromSystem(null), 'es');
  });

  test('an explicit choice wins over the phone', () => {
    assert.equal(resolveLanguage('es', 'en'), 'es');
    assert.equal(resolveLanguage('en', 'es'), 'en');
    assert.equal(resolveLanguage('system', 'en'), 'en');
  });
});
