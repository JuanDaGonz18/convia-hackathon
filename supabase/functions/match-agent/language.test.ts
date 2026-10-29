/**
 * Reply language: the message's, with Spanish place names ignored. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { detectLanguage } from './language.ts';

describe('reply language', () => {
  test('English messages full of Spanish place names are English', () => {
    for (const text of [
      'I need a ride from Universidad de La Sabana to Fontanar on Saturday at 11 am',
      'I need to get to La Sabana tomorrow at 7am from Cota',
      'Anything from Chía to the Universidad de La Sabana before 8?',
      'Este viaje no: show me trips from Cota to La Sabana tomorrow morning please',
    ]) assert.equal(detectLanguage(text, 'es'), 'en', text);
  });

  test('Spanish messages are Spanish, also with the app in English', () => {
    for (const text of [
      'Voy de la Universidad de La Sabana a Fontanar el sábado a las 7 de la mañana',
      'Necesito llegar a La Sabana mañana a las 7 desde Cota',
      'De Chía a La Sabana mañana a las 7, máximo 4.500 pesos',
      '¿Hay algo a Cota hoy?',
    ]) assert.equal(detectLanguage(text, 'en'), 'es', text);
  });

  test('no clear signal keeps the app language', () => {
    assert.equal(detectLanguage('Cota → La Sabana 7:00', 'en'), 'en');
    assert.equal(detectLanguage('Cota → La Sabana 7:00', 'es'), 'es');
    assert.equal(detectLanguage('', 'es'), 'es');
  });

  test('agent replies are detected too (the eval checks them)', () => {
    assert.equal(detectLanguage('Este viaje sale el sábado a las 11:00 desde Universidad de La Sabana, a solo 0,1 km de tu punto.', 'en'), 'es');
    assert.equal(detectLanguage('This trip leaves Saturday at 11:00 from Universidad de La Sabana, only 0.1 km from you, and costs 4000 COP.', 'es'), 'en');
  });
});
