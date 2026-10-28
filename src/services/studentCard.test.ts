import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { excludedBox, overlaps, regionsAroundFace, toBase64 } from './studentCard.ts';

describe('crops around the face', () => {
  test('a typical card (photo on the left) gives text on the right and around it', () => {
    const face = { x: 60, y: 120, width: 220, height: 280 };
    const regions = regionsAroundFace(face, 1600, 1000);
    assert.ok(regions.some((region) => region.side === 'right'));
    assert.ok(regions.every((region) => region.endX > region.startX && region.endY > region.startY));
  });

  test('no crop ever overlaps the face box plus its margin, wherever the face is', () => {
    const sizes = [[1600, 1000], [1000, 1600], [800, 800]];
    for (const [width, height] of sizes) {
      for (let x = 0; x < width; x += width / 8) {
        for (let y = 0; y < height; y += height / 8) {
          for (const side of [80, 200, 400]) {
            const face = { x, y, width: Math.min(side, width - x), height: Math.min(side * 1.25, height - y) };
            const box = excludedBox(face, width, height);
            for (const region of regionsAroundFace(face, width, height)) {
              assert.ok(!overlaps(region, box), JSON.stringify({ width, height, face, region }));
              assert.ok(region.startX >= 0 && region.startY >= 0 && region.endX <= width && region.endY <= height);
            }
          }
        }
      }
    }
  });

  test('the face itself is never inside a crop', () => {
    const face = { x: 700, y: 300, width: 200, height: 260 };
    for (const region of regionsAroundFace(face, 1600, 1000)) {
      assert.ok(!overlaps(region, { x0: face.x, y0: face.y, x1: face.x + face.width, y1: face.y + face.height }));
    }
  });

  test('a face filling the photo leaves nothing to send', () => {
    assert.deepEqual(regionsAroundFace({ x: 50, y: 50, width: 900, height: 900 }, 1000, 1000), []);
  });
});

describe('toBase64', () => {
  test('matches the standard encoding, with padding', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'ConVía ✨']) {
      const bytes = new TextEncoder().encode(text);
      assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'), text);
    }
  });
});
