/**
 * Mock mode (no MODEL_API_KEY): a fake model client that answers in SAM 3.1's
 * and Muse Spark's real formats, so parsing, confidence filtering, car and
 * plate selection and the decision all run exactly as with the real API.
 * Outcome: `mock_outcome` in the request, else by the plate's last digit
 * (7–8 → mismatch, 9 → retry, others → verified).
 */
import type { PickupReport, PickupStatus } from './decision.ts';
import type { ModelClient } from './model.ts';

const W = 1280;
const H = 720;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function mockOutcome(plate: string, requested: unknown): PickupStatus {
  if (requested === 'verified' || requested === 'mismatch' || requested === 'retry') return requested;
  return /[78]$/.test(plate) ? 'mismatch' : /9$/.test(plate) ? 'retry' : 'verified';
}

const box = (x1: number, y1: number, x2: number, y2: number, c: number) =>
  `<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${W};h=${H};c=${c}|><|mask;x=0;y=0;c=${c};data=2,2,!00|>`;

/** 30 frames: the arriving car (id 0) grows; a parked car (id 1) stays small and is lost (confidence near 0). */
function carLines() {
  return Array.from({ length: 30 }, (_, frame) => {
    const grow = frame * 8;
    return `<${frame}f>0${box(300 - grow, 200 - grow / 2, 900 + grow, 620 + grow / 4, 0.92)},1${box(40, 300, 160, 380, frame < 5 ? 0.6 : 0.02)}`;
  }).join('\n');
}

/** The plate of car 0 is visible from frame 10 on; best view around frame 24. */
function plateLines() {
  return Array.from({ length: 20 }, (_, index) => {
    const frame = index + 10;
    const confidence = Number((0.55 + 0.4 * (1 - Math.abs(frame - 24) / 14)).toFixed(2));
    return `<${frame}f>0${box(560, 560, 720, 610, confidence)}`;
  }).join('\n');
}

export function createMockClient(registered: { plate: string; brand: string; color: string }, outcome: PickupStatus): ModelClient {
  const latency = () => sleep(Math.round(300 + Math.random() * 400));
  return {
    async segmentVideo(_videoUrl, prompt) {
      await latency();
      if (prompt === 'license plate') return { text: outcome === 'retry' ? '' : plateLines(), framesProcessed: 50 };
      return { text: carLines(), framesProcessed: 50 };
    },
    async readPlate(): Promise<PickupReport> {
      await latency();
      const { plate } = registered;
      const shown = outcome === 'mismatch'
        ? `${plate.slice(0, 3)} ${String((Number(plate.slice(3)) + 417) % 1000).padStart(3, '0')}`
        : `${plate.slice(0, 3)} ${plate.slice(3)}`;
      return {
        plate_text: shown,
        plate_readable: true,
        brand: registered.brand.split(' ')[0]?.toLowerCase() || 'desconocida',
        brand_confidence: 0.9,
        line: registered.brand.split(' ').slice(1).join(' ').toLowerCase() || 'desconocida',
        color: registered.color.toLowerCase(),
        color_confidence: 0.9,
        image_quality: 'good',
        looks_like_screen_or_printout: false,
        confidence: 0.94,
      };
    },
  };
}
