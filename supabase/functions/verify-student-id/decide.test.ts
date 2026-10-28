/**
 * verify-student-id: card reading → decision. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type CardReport, decideCard, idLast4, institutionMatches, nameSimilarity, parseExpiry } from './decide.ts';

const sabana = { nombre: 'Universidad de La Sabana', nombre_corto: 'La Sabana', dominios: ['unisabana.edu.co'] };
const report = (changes: Partial<CardReport> = {}): CardReport => ({
  is_student_id_card: true,
  looks_like_screen_or_printout: false,
  readable: true,
  full_name: 'PABLO ANDRÉS DEMO RUIZ',
  institution_name: 'UNIVERSIDAD DE LA SABANA',
  id_number: '0000123456',
  expiry_date: '2027-06-30',
  confidence: 0.92,
  ...changes,
});
const context = { profileName: 'Pablo Demo', institution: sabana, faceMatch: true, today: '2026-10-28' };

describe('decideCard', () => {
  test('everything matches → verified, keeping only the last 4 ID digits', () => {
    const result = decideCard(report(), context);
    assert.equal(result.decision, 'verified');
    assert.deepEqual(result.reasons, []);
    assert.equal(result.idLast4, '3456');
    assert.equal(result.expiresOn, '2027-06-30');
  });

  test('unreadable → retry (the only case that asks to try again)', () => {
    assert.equal(decideCard(report({ readable: false }), context).decision, 'retry');
    assert.equal(decideCard(report({ full_name: null, institution_name: null }), context).decision, 'retry');
  });

  test('every doubt goes to review, never to an automatic rejection', () => {
    for (const [changes, reason, ctx] of [
      [{ is_student_id_card: false }, 'not_a_card', context],
      [{ looks_like_screen_or_printout: true }, 'screen_or_print', context],
      [{ institution_name: 'UNIVERSIDAD DE LOS ANDES' }, 'institution_mismatch', context],
      [{ expiry_date: null }, 'no_expiry', context],
      [{ expiry_date: '2025-12-31' }, 'expired', context],
      [{ full_name: 'PABLO GÓMEZ' }, 'name_partial', context],
      [{ full_name: 'LAURA PÉREZ' }, 'name_mismatch', context],
      [{}, 'face_mismatch', { ...context, faceMatch: false }],
      [{}, 'face_not_checked', { ...context, faceMatch: null }],
      [{ confidence: 0.4 }, 'low_confidence', context],
    ] as const) {
      const result = decideCard(report(changes), ctx);
      assert.equal(result.decision, 'review', reason);
      assert.ok(result.reasons.includes(reason), `${reason}: ${result.reasons.join(',')}`);
    }
  });

  test('a card valid until today is still valid', () => {
    assert.equal(decideCard(report({ expiry_date: '2026-10-28' }), context).decision, 'verified');
  });
});

describe('helpers', () => {
  test('names: accents, case, particles and order do not matter', () => {
    assert.equal(nameSimilarity('Pablo Demo', 'DEMO RUIZ, PABLO ANDRÉS'), 1);
    assert.equal(nameSimilarity('María de los Ángeles Peña', 'MARIA ANGELES PEÑA'), 1);
    assert.equal(nameSimilarity('Pablo Demo', 'PABLO GOMEZ'), 0.5);
    assert.equal(nameSimilarity('Pablo Demo', null), 0);
  });

  test('institution by its distinctive words, short name or domain', () => {
    assert.ok(institutionMatches('Universidad de La Sabana', sabana));
    assert.ok(institutionMatches('UNISABANA - Carné estudiantil', sabana));
    assert.ok(institutionMatches('Pontificia Universidad Javeriana', { nombre: 'Pontificia Universidad Javeriana', nombre_corto: 'Javeriana', dominios: ['javeriana.edu.co'] }));
    assert.ok(institutionMatches('UNIVERSIDAD EAFIT', { nombre: 'Universidad EAFIT', nombre_corto: 'EAFIT', dominios: ['eafit.edu.co'] }));
    assert.ok(!institutionMatches('Universidad de los Andes', sabana));
    assert.ok(!institutionMatches(null, sabana));
  });

  test('expiry formats', () => {
    assert.equal(parseExpiry('2027-06-30'), '2027-06-30');
    assert.equal(parseExpiry('30/06/2027'), '2027-06-30');
    assert.equal(parseExpiry('06/2027'), '2027-06-30');
    assert.equal(parseExpiry('2027-02'), '2027-02-28');
    assert.equal(parseExpiry('2027'), '2027-12-31');
    assert.equal(parseExpiry('junio'), null);
  });

  test('ID: only the last 4 letters or digits', () => {
    assert.equal(idLast4('1.020.304.567'), '4567');
    assert.equal(idLast4('A-12'), 'A12');
    assert.equal(idLast4(null), null);
  });
});
