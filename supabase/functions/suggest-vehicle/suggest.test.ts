/**
 * suggest-vehicle: from Muse Spark's answer to form suggestions.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatBrand, formatLine, isSuggestionReport, readPlate, type SuggestionReport, toSuggestion } from './suggest.ts';

const report = (changes: Partial<SuggestionReport> = {}): SuggestionReport => ({
  is_vehicle: true,
  looks_like_screen_or_printout: false,
  brand: 'mazda',
  brand_confidence: 0.9,
  line: 'cx-5',
  line_confidence: 0.8,
  color: 'gris',
  color_confidence: 0.85,
  plate_text: 'ABC 123',
  plate_readable: true,
  plate_confidence: 0.95,
  ...changes,
});

describe('suggestions', () => {
  test('a clear photo fills every field, formatted for the form', () => {
    assert.deepEqual(toSuggestion(report()), { status: 'ok', suggestion: { brand: 'Mazda', line: 'CX-5', color: 'Gris', plate: 'ABC123' } });
  });

  test('a field below its confidence threshold is left empty', () => {
    const outcome = toSuggestion(report({ line_confidence: 0.4, color_confidence: 0.3, plate_confidence: 0.6 }));
    assert.deepEqual(outcome, { status: 'ok', suggestion: { brand: 'Mazda', line: null, color: null, plate: null } });
  });

  test('a plate that is not fully legible is never suggested, however confident', () => {
    const outcome = toSuggestion(report({ plate_readable: false, plate_confidence: 0.99 }));
    assert.equal(outcome.status === 'ok' && outcome.suggestion.plate, null);
  });

  test('a line that repeats the brand is not doubled ("Mazda Mazda 3")', () => {
    const outcome = toSuggestion(report({ line: 'Mazda 3' }));
    assert.equal(outcome.status === 'ok' && outcome.suggestion.line, '3');
  });

  test('no line without a brand', () => {
    const outcome = toSuggestion(report({ brand: 'desconocida', brand_confidence: 0.2 }));
    assert.deepEqual(outcome, { status: 'ok', suggestion: { brand: null, line: null, color: 'Gris', plate: 'ABC123' } });
  });

  test('not a vehicle, a screen, or nothing certain: no suggestion', () => {
    assert.deepEqual(toSuggestion(report({ is_vehicle: false })), { status: 'unclear', reason: 'no_vehicle' });
    assert.deepEqual(toSuggestion(report({ looks_like_screen_or_printout: true })), { status: 'unclear', reason: 'not_a_real_vehicle' });
    const vague = report({ brand_confidence: 0.1, color: '', plate_text: '', plate_readable: false });
    assert.deepEqual(toSuggestion(vague), { status: 'unclear', reason: 'nothing_certain' });
  });

  test('colors outside the list are ignored; café keeps its accent', () => {
    assert.equal((toSuggestion(report({ color: 'morado' })) as { suggestion: { color: string | null } }).suggestion.color, null);
    assert.equal((toSuggestion(report({ color: 'cafe' })) as { suggestion: { color: string | null } }).suggestion.color, 'Café');
  });
});

describe('formatting', () => {
  test('brands', () => {
    assert.equal(formatBrand('  renault '), 'Renault');
    assert.equal(formatBrand('mercedes-benz'), 'Mercedes-Benz');
    assert.equal(formatBrand('bmw'), 'BMW');
    assert.equal(formatBrand('land rover'), 'Land Rover');
  });

  test('lines', () => {
    assert.equal(formatLine('spark gt'), 'Spark GT');
    assert.equal(formatLine('cx-5'), 'CX-5');
    assert.equal(formatLine('3'), '3');
    assert.equal(formatLine('sandero stepway'), 'Sandero Stepway');
  });

  test('plates: car with OCR fix-ups, motorcycle as read, anything else rejected', () => {
    assert.equal(readPlate('AB0-123'), 'ABO123');
    assert.equal(readPlate('xyz 98a'), 'XYZ98A');
    assert.equal(readPlate('ABC12D'), 'ABC12D');
    assert.equal(readPlate('AB123'), null);
    assert.equal(readPlate(''), null);
  });

  test('the report shape is checked before use', () => {
    assert.equal(isSuggestionReport(report()), true);
    assert.equal(isSuggestionReport({ ...report(), plate_confidence: '0.9' }), false);
    assert.equal(isSuggestionReport(null), false);
  });
});
