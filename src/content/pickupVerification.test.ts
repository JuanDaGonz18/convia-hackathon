import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PICKUP_REASONS } from '../../supabase/functions/verify-pickup/decision.ts';
import { flatten } from '../i18n/languages.ts';
import { FILMING_TIPS, KNOWN_COLORS, PICKUP_CLIENT_REASONS } from './pickupVerification.ts';

const locales = Object.fromEntries(['es', 'en'].map((lang) => [
  lang,
  flatten(JSON.parse(readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), 'utf8'))),
]));

for (const lang of ['es', 'en']) {
  const texts = locales[lang];

  test(`${lang}: every retry reason the server or the app can return has a title and a text`, () => {
    for (const reason of [...PICKUP_REASONS.retry, ...PICKUP_CLIENT_REASONS]) {
      assert.ok(texts[`pickup.retry.${reason}.title`] && texts[`pickup.retry.${reason}.text`], `missing pickup.retry.${reason}`);
    }
  });

  test(`${lang}: every mismatch reason has an explanation`, () => {
    for (const reason of PICKUP_REASONS.mismatch) assert.ok(texts[`pickup.mismatch.${reason}`], `missing pickup.mismatch.${reason}`);
  });

  test(`${lang}: filming tips and color names exist`, () => {
    for (const tip of FILMING_TIPS) assert.ok(texts[`pickup.tips.${tip}`], `missing pickup.tips.${tip}`);
    for (const color of KNOWN_COLORS) assert.ok(texts[`colors.${color}`], `missing colors.${color}`);
  });
}
