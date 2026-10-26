/**
 * verify-pickup analysis, from clip to verdict:
 *  1. Read fps and length from the MP4; reject long clips before paying for them.
 *  2. SAM 3.1 runs "car" and "license plate" on the clip in parallel. The clip goes inline, so it
 *     is never stored at the model provider.
 *  3. Keep detections above the confidence threshold, pick the main car and its best plate view.
 *  4. Muse Spark reads the frame the app extracted closest to that moment (Edge Functions can't run ffmpeg).
 *  5. decidePickup() turns the reading into verified / mismatch / retry.
 * Model failures end in retry, never in an error. Each step's duration is recorded.
 * The model client is injected, so tests and the real-clip script run the same code.
 */
import { decidePickup, type PickupDecision, type PickupReport, pickupRetry } from './decision.ts';
import { ModelError, type ModelClient, type ModelErrorKind } from './model.ts';
import { readVideoInfo } from './mp4.ts';
import { type ClipFrame, filterConfident, nearestFrame, parseSamVideo, pickMainCar, pickPlate, scaleBox } from './tracks.ts';

export type FrameSource = ClipFrame & { load(): Promise<Uint8Array> };

export type PipelineConfig = {
  /** SAM detections below this confidence are ignored (calibrated with real clips). */
  minConfidence: number;
  maxDurationS: number;
};

/** 3 s keeps SAM at ~180 billed frames per check (30 fps × 2 prompts) and is enough for a car that has stopped. */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { minConfidence: 0.5, maxDurationS: 3 };

export type PipelineResult = {
  decision: PickupDecision;
  report: PickupReport | null;
  /** Frames SAM billed (both prompts), or null if it didn't run. */
  framesProcessed: number | null;
  timings: Record<string, number>;
  /** For logs and calibration; never shown to users. */
  debug: Record<string, unknown>;
};

const MODEL_ERROR_REASON: Record<ModelErrorKind, 'timeout' | 'rate_limited' | 'service_unavailable' | 'bad_model_response'> = {
  timeout: 'timeout',
  rate_limited: 'rate_limited',
  http: 'service_unavailable',
  malformed: 'bad_model_response',
};

/** Clips may run a little over the limit (encoder rounding). */
const DURATION_TOLERANCE_S = 0.6;

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export async function analyzeClip(
  clip: { video: Uint8Array; frames: FrameSource[] },
  registered: { plate: string; brand: string; color: string },
  client: ModelClient,
  config: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
): Promise<PipelineResult> {
  const timings: Record<string, number> = {};
  const debug: Record<string, unknown> = {};
  let framesProcessed: number | null = null;
  let report: PickupReport | null = null;
  const timed = async <T>(step: string, run: () => Promise<T>) => {
    const started = performance.now();
    try {
      return await run();
    } finally {
      timings[step] = Math.round(performance.now() - started);
    }
  };
  const done = (decision: PickupDecision): PipelineResult => ({ decision, report, framesProcessed, timings, debug });

  const info = readVideoInfo(clip.video);
  if (!info) return done(pickupRetry('clip_unreadable'));
  debug.video = info;
  if (info.durationS > config.maxDurationS + DURATION_TOLERANCE_S) return done(pickupRetry('clip_too_long'));

  try {
    const videoUrl = `data:${info.mimeType};base64,${toBase64(clip.video)}`;
    const [cars, plates] = await timed('sam', () => Promise.all([client.segmentVideo(videoUrl, 'car'), client.segmentVideo(videoUrl, 'license plate')]));
    framesProcessed = cars.framesProcessed !== null || plates.framesProcessed !== null
      ? (cars.framesProcessed ?? 0) + (plates.framesProcessed ?? 0)
      : null;

    const carDetections = filterConfident(parseSamVideo(cars.text), config.minConfidence);
    const plateDetections = filterConfident(parseSamVideo(plates.text), config.minConfidence);
    debug.validCarFrames = carDetections.length;
    debug.validPlateFrames = plateDetections.length;
    const car = pickMainCar(carDetections);
    if (!car) return done(pickupRetry('no_car'));
    debug.mainCar = { id: car.id, frames: car.boxes.size, meanArea: Number(car.meanArea.toFixed(3)) };
    const plate = pickPlate(plateDetections, car);
    if (!plate) return done(pickupRetry('no_plate'));
    debug.plate = { frame: plate.frame, box: plate.box, score: Number(plate.score.toFixed(5)) };

    const frame = nearestFrame(clip.frames, plate.frame, info.fps);
    if (!frame) return done(pickupRetry('frame_missing'));
    debug.frameTimeMs = frame.timeMs;
    const image = await frame.load();
    const imageUrl = `data:image/jpeg;base64,${toBase64(image)}`;
    report = await timed('muse', () => client.readPlate(imageUrl, scaleBox(plate.box, frame.width, frame.height)));
    return done(decidePickup(report, registered));
  } catch (error) {
    if (!(error instanceof ModelError)) throw error;
    debug.modelError = { kind: error.kind, detail: error.message };
    return done(pickupRetry(MODEL_ERROR_REASON[error.kind]));
  }
}
