/**
 * The English legal texts mirror the Spanish ones: same sections, same blocks, same bullet lists.
 * Run with `npm test`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { type LegalDocument, PRIVACY, TERMS } from './legal.ts';

// legalLocalized.ts imports JSON through the app's bundler; the same rebuild is done here.
function restoreArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreArrays);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const isArray = entries.length > 0 && entries.every(([key], index) => key === String(index));
  return isArray ? entries.map(([, item]) => restoreArrays(item)) : Object.fromEntries(entries.map(([key, item]) => [key, restoreArrays(item)]));
}

const english = restoreArrays(JSON.parse(readFileSync(new URL('./legal.en.json', import.meta.url), 'utf8'))) as { terms: LegalDocument; privacy: LegalDocument };

const shape = (document: LegalDocument) => ({
  summary: document.summary.length,
  sections: document.sections.map((section) => ({
    id: section.id,
    blocks: section.body.map((block) => (typeof block === 'string' ? 'text' : block.bullets.length)),
  })),
});

describe('legal texts in English', () => {
  test('the terms have the same sections, blocks and bullets as the Spanish', () => {
    assert.deepEqual(shape(english.terms), shape(TERMS));
  });

  test('the privacy policy too', () => {
    assert.deepEqual(shape(english.privacy), shape(PRIVACY));
  });

  test('every string is translated (not left empty)', () => {
    const strings = JSON.stringify(english).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    assert.ok(strings.every((text) => text !== '""'));
  });
});
