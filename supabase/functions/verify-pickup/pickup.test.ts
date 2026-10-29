/**
 * verify-pickup: frame parsing, confidence filter, car and plate selection,
 * MP4 reading, the decision, and the whole pipeline with a fake model client.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { decidePickup, neighborColors, PICKUP_REASONS, type PickupReport } from './decision.ts';
import { createMockClient } from './mock.ts';
import { ModelError, type ModelClient } from './model.ts';
import { readVideoInfo } from './mp4.ts';
import { analyzeClip, DEFAULT_PIPELINE_CONFIG, type FrameSource } from './pipeline.ts';
import { filterConfident, nearestFrame, parseSamVideo, pickMainCar, pickPlate, scaleBox } from './tracks.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const REGISTERED = { plate: 'ABC123', brand: 'Renault Logan', color: 'Gris' };

const box = (x1: number, y1: number, x2: number, y2: number, c: number | null, w = 1000, h = 800) =>
  `<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${w};h=${h}${c === null ? '' : `;c=${c}`}|><|mask;x=0;y=0;data=3,4,!a,b<c|>`;

function report(overrides: Partial<PickupReport> = {}): PickupReport {
  return {
    plate_text: 'ABC 123',
    plate_readable: true,
    brand: 'renault',
    brand_confidence: 0.95,
    line: 'logan',
    color: 'plata',
    color_confidence: 0.9,
    image_quality: 'good',
    looks_like_screen_or_printout: false,
    confidence: 0.93,
    ...overrides,
  };
}

describe('parseSamVideo', () => {
  test('reads every object on every frame, keyed by id, and ignores masks', () => {
    const text = `<0f>0${box(10, 10, 500, 400, 0.9)},2${box(600, 100, 700, 200, 0.4)}\n<3f>2${box(610, 100, 710, 200, 0.45)}\n`;
    const detections = parseSamVideo(text);
    assert.deepEqual(detections.map((d) => [d.frame, d.id, d.box.x1, d.box.confidence]), [[0, 0, 10, 0.9], [0, 2, 600, 0.4], [3, 2, 610, 0.45]]);
  });

  test('empty answer (no matches) and junk lines give no detections', () => {
    assert.deepEqual(parseSamVideo(''), []);
    assert.deepEqual(parseSamVideo('hello\n<x>0<|box;x1=1|>'), []);
  });
});

describe('filterConfident', () => {
  test('a line is not tracking: low or missing confidence is dropped', () => {
    const detections = parseSamVideo(`<0f>0${box(0, 0, 10, 10, 0.74)}\n<1f>0${box(0, 0, 10, 10, 0.0003)}\n<2f>0${box(0, 0, 10, 10, null)}\n<3f>0${box(0, 0, 10, 10, 0.5)}`);
    assert.deepEqual(filterConfident(detections, 0.5).map((d) => d.frame), [0, 3]);
  });
});

describe('pickMainCar / pickPlate', () => {
  const lines: string[] = [];
  for (let frame = 0; frame < 10; frame++) {
    // id 0: big car in view the whole clip; id 1: bigger car crossing for 2 frames; id 2: small parked car.
    const records = [`0${box(200, 200, 800, 700, 0.9)}`, `2${box(20, 20, 120, 90, 0.9)}`];
    if (frame < 2) records.push(`1${box(0, 0, 1000, 800, 0.9)}`);
    lines.push(`<${frame}f>${records.join(',')}`);
  }
  const cars = parseSamVideo(lines.join('\n'));
  const car = pickMainCar(cars)!;

  test('main car = most valid frames × largest area', () => {
    assert.equal(car.id, 0);
    assert.equal(car.boxes.size, 10);
  });

  test('plate = best confidence × area inside the main car, with its frame', () => {
    const plates = parseSamVideo([
      `<2f>0${box(450, 600, 550, 640, 0.6)}`,
      `<5f>0${box(440, 590, 560, 645, 0.9)}`,
      // Bigger and surer, but on the parked car.
      `<6f>1${box(30, 40, 110, 80, 0.99)}`,
      // Inside the car's area but on a frame where the car wasn't tracked.
      `<12f>0${box(440, 590, 560, 645, 0.99)}`,
    ].join('\n'));
    const plate = pickPlate(plates, car)!;
    assert.equal(plate.frame, 5);
    assert.equal(plate.box.x1, 440);
  });

  test('no car or no plate on the car → null', () => {
    assert.equal(pickMainCar([]), null);
    assert.equal(pickPlate(parseSamVideo(`<1f>0${box(20, 20, 60, 40, 0.9)}`), car), null);
  });
});

describe('frames', () => {
  test('nearest extracted frame to a SAM frame index, and box scaled to it', () => {
    const frames = [0, 500, 1000, 1500].map((timeMs) => ({ timeMs, width: 500, height: 400 }));
    assert.equal(nearestFrame(frames, 40, 30)?.timeMs, 1500); // 1.33 s
    assert.equal(nearestFrame(frames, 14, 30)?.timeMs, 500); // 0.47 s
    assert.equal(nearestFrame([], 3, 30), null);
    const [plate] = parseSamVideo(`<0f>0${box(400, 600, 600, 680, 0.9)}`);
    assert.deepEqual(scaleBox(plate.box, 500, 400), { x1: 200, y1: 300, x2: 300, y2: 340, w: 500, h: 400, confidence: 0.9 });
  });
});

describe('readVideoInfo', () => {
  test('frame count, duration and fps of MP4 (index at start or end) and MOV', () => {
    for (const name of ['square-faststart.mp4', 'square-moov-at-end.mp4']) {
      const info = readVideoInfo(fixture(name))!;
      assert.equal(info.frameCount, 60, name);
      assert.ok(Math.abs(info.durationS - 2) < 0.01, `${name}: ${info.durationS}`);
      assert.ok(Math.abs(info.fps - 30) < 0.1, `${name}: ${info.fps}`);
    }
    assert.equal(readVideoInfo(fixture('square-faststart.mp4'))!.mimeType, 'video/mp4');
    const mov = readVideoInfo(fixture('black-24fps.mov'))!;
    assert.equal(mov.frameCount, 36);
    assert.ok(Math.abs(mov.fps - 24) < 0.1);
    assert.equal(mov.mimeType, 'video/quicktime');
  });

  test('not a video → null', () => {
    assert.equal(readVideoInfo(new TextEncoder().encode('not a video at all')), null);
    assert.equal(readVideoInfo(fixture('square-faststart.mp4').slice(0, 40)), null);
  });
});

describe('decidePickup', () => {
  const verdict = (overrides: Partial<PickupReport>) => {
    const decision = decidePickup(report(overrides), REGISTERED);
    return `${decision.status}/${decision.reason}`;
  };

  test('plate, brand and color match → verified', () => {
    assert.equal(verdict({}), 'verified/plate_match');
  });

  test('another plate read with confidence → mismatch; read with doubt → retry', () => {
    assert.equal(verdict({ plate_text: 'XYZ 987', confidence: 0.92 }), 'mismatch/plate_mismatch');
    assert.equal(verdict({ plate_text: 'XYZ 987', confidence: 0.7 }), 'retry/plate_uncertain');
    assert.equal(verdict({ plate_text: 'ABC 128', confidence: 0.7 }), 'retry/plate_uncertain');
  });

  test('right plate, clearly another brand → mismatch (copied plate); unsure brand → retry, never an accusation', () => {
    assert.equal(verdict({ brand: 'chevrolet', brand_confidence: 0.95 }), 'mismatch/brand_mismatch');
    assert.equal(verdict({ brand: 'chevrolet', brand_confidence: 0.6 }), 'retry/vehicle_uncertain');
    assert.equal(verdict({ brand: 'desconocida', brand_confidence: 0.1 }), 'verified/plate_match');
  });

  test('right plate, clearly another color that light cannot explain → mismatch; unsure → retry', () => {
    assert.equal(verdict({ color: 'rojo', color_confidence: 0.95 }), 'mismatch/color_mismatch');
    assert.equal(verdict({ color: 'rojo', color_confidence: 0.6 }), 'retry/vehicle_uncertain');
  });

  test('neighbor colors (light, shade, reflections) are not evidence of another car', () => {
    // Registered Gris, read as plata (same family), azul oscuro, negro or blanco, even with high confidence.
    for (const color of ['plata', 'grafito', 'azul', 'negro', 'blanco']) {
      assert.equal(verdict({ color, color_confidence: 0.99 }), 'verified/plate_match', color);
    }
    assert.ok(neighborColors('Azul oscuro', 'gris'));
    assert.ok(neighborColors('Rojo', 'vinotinto') === false); // same family, not neighbors: colorMatches already accepts it
    assert.ok(!neighborColors('Blanco', 'rojo'));
    assert.equal(decidePickup(report({ color: 'rojo', color_confidence: 0.99 }), { ...REGISTERED, color: 'Vinotinto' }).status, 'verified');
  });

  test('a strong brand signal wins over a weak color doubt, and a missing confidence never accuses', () => {
    assert.equal(verdict({ brand: 'chevrolet', brand_confidence: 0.9, color: 'rojo', color_confidence: 0.3 }), 'mismatch/brand_mismatch');
    assert.equal(verdict({ brand: 'chevrolet', brand_confidence: undefined as unknown as number }), 'retry/vehicle_uncertain');
  });

  test('unreadable or doubtful readings → retry, never mismatch', () => {
    assert.equal(verdict({ plate_readable: false }), 'retry/plate_unreadable');
    assert.equal(verdict({ confidence: 0.3 }), 'retry/low_confidence');
    assert.equal(verdict({ image_quality: 'poor' }), 'retry/poor_quality');
  });

  test('every reason it returns is a declared reason', () => {
    const all: readonly string[] = Object.values(PICKUP_REASONS).flat();
    const samples = [{}, { plate_text: 'XYZ 987' }, { color: 'rojo' }, { brand: 'kia' }, { plate_readable: false }, { looks_like_screen_or_printout: true }];
    for (const sample of samples) assert.ok(all.includes(decidePickup(report(sample), REGISTERED).reason));
  });
});

describe('analyzeClip', () => {
  const frames: FrameSource[] = [0, 500, 1000, 1500].map((timeMs) => ({ timeMs, width: 640, height: 360, load: async () => new Uint8Array([0xff, 0xd8, 0xff]) }));
  const clip = { video: fixture('square-faststart.mp4'), frames };

  test('mock client runs the real parsing and decision: verified, mismatch, retry', async () => {
    for (const outcome of ['verified', 'mismatch', 'retry'] as const) {
      const steps: string[] = [];
      const result = await analyzeClip(clip, REGISTERED, createMockClient(REGISTERED, outcome), DEFAULT_PIPELINE_CONFIG, (step) => steps.push(step));
      assert.equal(result.decision.status, outcome);
      assert.equal(steps[0], 'car_found', outcome);
      if (outcome !== 'retry') assert.deepEqual(steps, ['car_found', 'plate_found', 'reading_plate'], outcome);
      assert.equal(typeof result.timings.total, 'number');
    }
  });

  test("\"it's your ride\" ends early, once SAM shows the plate on the main car; a mismatch waits for the whole clip", async () => {
    const verified = await analyzeClip(clip, REGISTERED, createMockClient(REGISTERED, 'verified'));
    assert.ok(verified.debug.earlyExit, 'verified should exit early');
    assert.equal(verified.timings.sam_done, undefined);
    assert.equal(verified.framesProcessed, 2 * 60); // estimated from the clip: SAM bills it all anyway
    const mismatch = await analyzeClip(clip, REGISTERED, createMockClient(REGISTERED, 'mismatch'));
    assert.equal(mismatch.debug.earlyExit, undefined);
    assert.equal(typeof mismatch.timings.sam_done, 'number');
    assert.equal(mismatch.framesProcessed, 100);
  });

  test("Muse reads the middle frame while SAM runs, and reads SAM's frame instead when the middle one does not show the plate", async () => {
    const loaded: number[] = [];
    const tracked = [0, 500, 1500, 1900].map((timeMs) => ({ timeMs, width: 640, height: 360, load: async () => { loaded.push(timeMs); return new Uint8Array([0xff]); } }));
    // Mock plate lines cover frames 10-29 (0.33-0.97 s at 30 fps), best at frame 24 (0.8 s).
    // The middle frame (1500 ms = frame 45) doesn't show it, so Muse reads the frame nearest to 0.8 s (500 ms).
    const result = await analyzeClip({ ...clip, frames: tracked }, REGISTERED, createMockClient(REGISTERED, 'mismatch'));
    assert.equal(result.decision.status, 'mismatch');
    assert.equal(result.debug.museFrame, 'sam_pick');
    assert.deepEqual(loaded, [1500, 500]);
  });

  test("a middle frame only good for \"film again\" gets a second reading on SAM's frame (approaching car, night)", async () => {
    const loaded: number[] = [];
    const tracked = [0, 500, 1000].map((timeMs) => ({ timeMs, width: 640, height: 360, load: async () => { loaded.push(timeMs); return new Uint8Array([0xff]); } }));
    // The middle frame (500 ms = frame 15) shows the plate, but too small to read; SAM's best is frame 24 (0.8 s → 1000 ms).
    const base = createMockClient(REGISTERED, 'verified');
    let reads = 0;
    const client: ModelClient = {
      ...base,
      async readPlate(image, box) {
        reads += 1;
        const report = await base.readPlate(image, box);
        return reads === 1 ? { ...report, plate_text: '', plate_readable: false, confidence: 0, image_quality: 'poor' } : report;
      },
    };
    const result = await analyzeClip({ ...clip, frames: tracked }, REGISTERED, client);
    assert.equal(result.decision.status, 'verified');
    assert.equal(result.debug.museFrame, 'middle_then_sam_pick');
    assert.deepEqual(loaded, [500, 1000]);

    // A middle reading that already decides (here a mismatch) is not read again.
    loaded.length = 0;
    const mismatch = await analyzeClip({ ...clip, frames: tracked }, REGISTERED, createMockClient(REGISTERED, 'mismatch'));
    assert.equal(mismatch.decision.status, 'mismatch');
    assert.equal(mismatch.debug.museFrame, 'middle');
  });

  test('the clip goes inline with its real MIME type, and a model failure is a retry', async () => {
    const urls: string[] = [];
    const failing: ModelClient = {
      ...createMockClient(REGISTERED, 'verified'),
      async segmentVideo(videoUrl) { urls.push(videoUrl); throw new ModelError('timeout', 'slow'); },
    };
    const result = await analyzeClip({ video: fixture('black-24fps.mov'), frames }, REGISTERED, failing);
    assert.deepEqual([result.decision.status, result.decision.reason], ['retry', 'timeout']);
    assert.ok(urls.length === 2 && urls.every((url) => url.startsWith('data:video/quicktime;base64,')));
  });

  test('zero confident frames → retry no_car (Muse already started on the middle frame, its answer is ignored)', async () => {
    let museCalls = 0;
    const lost: ModelClient = {
      ...createMockClient(REGISTERED, 'verified'),
      async segmentVideo() { return { text: `<0f>0${box(0, 0, 900, 700, 0.2)}\n<1f>0${box(0, 0, 900, 700, 0.001)}`, framesProcessed: 50 }; },
      async readPlate() { museCalls++; return report(); },
    };
    const result = await analyzeClip(clip, REGISTERED, lost);
    assert.deepEqual([result.decision.reason, museCalls], ['no_car', 1]);
  });

  test('a threshold above every detection turns a good clip into a retry', async () => {
    const result = await analyzeClip(clip, REGISTERED, createMockClient(REGISTERED, 'verified'), { ...DEFAULT_PIPELINE_CONFIG, minConfidence: 0.99 });
    assert.equal(result.decision.reason, 'no_car');
  });

  test('unreadable or too long clips are rejected before any model call', async () => {
    let calls = 0;
    const counting: ModelClient = { ...createMockClient(REGISTERED, 'verified'), async segmentVideo() { calls++; return { text: '', framesProcessed: 50 }; } };
    assert.equal((await analyzeClip({ video: new Uint8Array(10), frames }, REGISTERED, counting)).decision.reason, 'clip_unreadable');
    assert.equal((await analyzeClip(clip, REGISTERED, counting, { ...DEFAULT_PIPELINE_CONFIG, maxDurationS: 1 })).decision.reason, 'clip_too_long');
    assert.equal(calls, 0);
  });
});
