/**
 * verify-pickup analysis, from clip to verdict, overlapping the two models:
 *  1. Read fps and length from the MP4; reject long clips before paying for them.
 *  2. At once: SAM 3.1 streams "car" and "license plate" over the clip (inline, never stored at the
 *     provider), and Muse Spark starts reading the middle frame, which shows a stopped car well.
 *  3. Early exit, only for "it's your ride": as soon as Muse has read the trip's plate and SAM's
 *     stream shows that plate inside the main car on that frame (seen on enough frames), answer
 *     without waiting for the rest of the stream.
 *  4. Otherwise wait for all of SAM (a "don't get in" needs the whole clip), pick the main car and
 *     its best plate view, and use Muse's reading if it was of that car's plate; if not, read the
 *     frame SAM picked.
 *  5. decidePickup() turns the reading into verified / mismatch / retry.
 * Model failures end in retry, never in an error. Each step's time is recorded, and progress is
 * reported as it happens (car found, plate found, reading the plate).
 * The model client is injected, so tests and the real-clip script run the same code.
 */
import { decidePickup, type PickupDecision, type PickupReport, pickupRetry } from './decision.ts';
import { ModelError, type ModelClient, type ModelErrorKind } from './model.ts';
import { readVideoInfo } from './mp4.ts';
import {
  type ClipFrame,
  type Detection,
  filterConfident,
  nearestFrame,
  parseSamVideo,
  pickMainCar,
  pickPlate,
  plateOnCar,
  platesOnCar,
  scaleBox,
  type Track,
} from './tracks.ts';

export type FrameSource = ClipFrame & { load(): Promise<Uint8Array> };

export type PipelineConfig = {
  /** SAM detections below this confidence are ignored (calibrated with real clips). */
  minConfidence: number;
  maxDurationS: number;
  /** Early "verified" needs the main car and its plate on at least this many streamed frames. */
  earlyFrames: number;
};

/** 3 s keeps SAM at ~180 billed frames per check (30 fps × 2 prompts) and is enough for a car that has stopped. */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = { minConfidence: 0.5, maxDurationS: 3, earlyFrames: 5 };

export type ProgressStep = 'car_found' | 'plate_found' | 'reading_plate';

export type PipelineResult = {
  decision: PickupDecision;
  report: PickupReport | null;
  /** Frames SAM billed (both prompts), or null if it didn't finish. */
  framesProcessed: number | null;
  /** Milliseconds from the start of the analysis to each milestone. */
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
/** Frames between Muse's frame and a SAM plate detection that still count as the same moment (variable frame rate). */
const FRAME_TOLERANCE = 3;

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

type Reading = { frame: FrameSource; frameIndex: number; report: Promise<PickupReport> };

export async function analyzeClip(
  clip: { video: Uint8Array; frames: FrameSource[] },
  registered: { plate: string; brand: string; color: string },
  client: ModelClient,
  config: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
  onProgress: (step: ProgressStep) => void = () => undefined,
): Promise<PipelineResult> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  const debug: Record<string, unknown> = {};
  const mark = (name: string) => { timings[name] ??= Math.round(performance.now() - started); };
  let framesProcessed: number | null = null;
  let report: PickupReport | null = null;
  const done = (decision: PickupDecision): PipelineResult => {
    mark('total');
    return { decision, report, framesProcessed, timings, debug };
  };

  const info = readVideoInfo(clip.video);
  if (!info) return done(pickupRetry('clip_unreadable'));
  debug.video = info;
  if (info.durationS > config.maxDurationS + DURATION_TOLERANCE_S) return done(pickupRetry('clip_too_long'));
  if (!clip.frames.length) return done(pickupRetry('frame_missing'));

  const read = (frame: FrameSource, plateBox: Parameters<ModelClient['readPlate']>[1]): Reading => ({
    frame,
    frameIndex: Math.round((frame.timeMs / 1000) * info.fps),
    report: frame.load().then((bytes) => client.readPlate(`data:image/jpeg;base64,${toBase64(bytes)}`, plateBox)),
  });

  // Muse starts right away on the middle frame; its answer is only used if SAM agrees it shows the main car's plate.
  const middle = [...clip.frames].sort((a, b) => a.timeMs - b.timeMs)[Math.floor(clip.frames.length / 2)];
  const speculative = read(middle, null);
  speculative.report.then(() => mark('muse_middle'), () => undefined);

  const cars: Detection[] = [];
  const plates: Detection[] = [];
  const stopSam = new AbortController();
  let announcedCar = false;
  let announcedPlate = false;
  let resolveEarly: (decision: PickupDecision) => void = () => undefined;
  const early = new Promise<PickupDecision>((resolve) => { resolveEarly = resolve; });

  /** The speculative frame shows `car`'s plate (per SAM, around that frame index). */
  const speculativeShows = (car: Track) => plateOnCar(plates, car, speculative.frameIndex, FRAME_TOLERANCE);

  const checkEarly = async () => {
    const car = pickMainCar(cars);
    if (!car || car.boxes.size < config.earlyFrames) return;
    const plateFrames = platesOnCar(plates, car).length;
    if (plateFrames < config.earlyFrames || !speculativeShows(car)) return;
    const reading = await speculative.report.catch(() => null);
    if (!reading) return;
    const decision = decidePickup(reading, registered);
    // Only a positive match ends early; anything else waits for the whole clip.
    if (decision.status !== 'verified') return;
    report = reading;
    debug.earlyExit = { carId: car.id, carFrames: car.boxes.size, plateFrames, frameIndex: speculative.frameIndex };
    resolveEarly(decision);
  };

  const onLine = (into: Detection[], kind: 'car' | 'plate') => (line: string) => {
    into.push(...filterConfident(parseSamVideo(line), config.minConfidence));
    if (kind === 'car' && !announcedCar && cars.length) {
      announcedCar = true;
      mark('car_found');
      onProgress('car_found');
    }
    const mainCar = announcedPlate ? null : pickMainCar(cars);
    if (mainCar && pickPlate(plates, mainCar)) {
      announcedPlate = true;
      mark('plate_found');
      onProgress('plate_found');
      onProgress('reading_plate');
    }
    void checkEarly();
  };

  try {
    const videoUrl = `data:${info.mimeType};base64,${toBase64(clip.video)}`;
    const sam = Promise.all([
      client.segmentVideo(videoUrl, 'car', { onLine: onLine(cars, 'car'), signal: stopSam.signal }),
      client.segmentVideo(videoUrl, 'license plate', { onLine: onLine(plates, 'plate'), signal: stopSam.signal }),
    ]);
    const first = await Promise.race([sam.then((results) => ({ kind: 'sam' as const, results })), early.then((decision) => ({ kind: 'early' as const, decision }))]);
    if (first.kind === 'early') {
      mark('decided');
      stopSam.abort();
      sam.catch(() => undefined);
      // SAM bills the whole clip even when we stop reading (at least 50 frames per prompt).
      framesProcessed = 2 * Math.max(50, info.frameCount);
      debug.framesEstimated = true;
      return done(first.decision);
    }
    mark('sam_done');
    const [carResult, plateResult] = first.results;
    framesProcessed = carResult.framesProcessed !== null || plateResult.framesProcessed !== null
      ? (carResult.framesProcessed ?? 0) + (plateResult.framesProcessed ?? 0)
      : null;
    // The streamed lines are the whole answer; parse it again in case a line arrived split.
    cars.splice(0, cars.length, ...filterConfident(parseSamVideo(carResult.text), config.minConfidence));
    plates.splice(0, plates.length, ...filterConfident(parseSamVideo(plateResult.text), config.minConfidence));
    debug.validCarFrames = cars.length;
    debug.validPlateFrames = plates.length;

    const car = pickMainCar(cars);
    if (!car) return done(pickupRetry('no_car'));
    debug.mainCar = { id: car.id, frames: car.boxes.size, meanArea: Number(car.meanArea.toFixed(3)) };
    const plate = pickPlate(plates, car);
    if (!plate) return done(pickupRetry('no_plate'));
    debug.plate = { frame: plate.frame, box: plate.box, score: Number(plate.score.toFixed(5)) };

    const samFrame = nearestFrame(clip.frames, plate.frame, info.fps);
    const readSamPick = () => read(samFrame!, scaleBox(plate.box, samFrame!.width, samFrame!.height));
    let reading: Reading;
    if (speculativeShows(car)) {
      reading = speculative;
      debug.museFrame = 'middle';
      // An approaching car shows its plate best near the end: if the middle frame was only good
      // enough for "film again", read the frame SAM picked once before asking the user to retry.
      const middleReport = await speculative.report;
      if (decidePickup(middleReport, registered).status === 'retry' && samFrame && samFrame !== speculative.frame) {
        reading = readSamPick();
        debug.museFrame = 'middle_then_sam_pick';
      }
    } else {
      if (!samFrame) return done(pickupRetry('frame_missing'));
      reading = readSamPick();
      debug.museFrame = 'sam_pick';
    }
    debug.frameTimeMs = reading.frame.timeMs;
    report = await reading.report;
    mark('muse_done');
    return done(decidePickup(report, registered));
  } catch (error) {
    stopSam.abort();
    if (!(error instanceof ModelError)) throw error;
    debug.modelError = { kind: error.kind, detail: error.message };
    return done(pickupRetry(MODEL_ERROR_REASON[error.kind]));
  }
}
