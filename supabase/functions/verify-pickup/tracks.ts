/**
 * SAM 3.1 video output → tracked objects. One line per frame:
 *   <12f>0<|box;…;c=0.91|><|mask;…|>,3<|box;…|><|mask;…|>
 * The leading number of each record is an object id that stays the same
 * across frames. A line only means SAM emitted something: a lost object can
 * keep a box with a confidence near 0, so detections are filtered by
 * confidence before any of them counts.
 * No Deno APIs, so it can be unit-tested with Node.
 */
import { boxArea, parseSamBoxes, type SamBox } from '../verify-vehicle/sam.ts';

export type Detection = { frame: number; id: number; box: SamBox };

export type Track = {
  id: number;
  /** Frame index → box, only frames that passed the confidence filter. */
  boxes: Map<number, SamBox>;
  meanArea: number;
};

export type PlatePick = { frame: number; box: SamBox; score: number };

const FRAME_LINE = /^<(\d+)f>(.*)$/;
// Mask payloads (base85) never contain '|', so a mask token ends at the first '|>'.
const MASK_TOKEN = /<\|mask;[^|]*\|>/g;
const RECORD = /(\d+)(<\|box;[^|]*\|>)/g;

/** Every (frame, object id, box) in a SAM video answer. Frames without objects have no line. */
export function parseSamVideo(text: string): Detection[] {
  const detections: Detection[] = [];
  for (const line of text.split('\n')) {
    const match = FRAME_LINE.exec(line.trim());
    if (!match) continue;
    const frame = Number(match[1]);
    for (const record of match[2].replace(MASK_TOKEN, '').matchAll(RECORD)) {
      const [box] = parseSamBoxes(record[2]);
      if (box) detections.push({ frame, id: Number(record[1]), box });
    }
  }
  return detections;
}

/** Keeps detections at or above the threshold. A missing confidence never passes. */
export function filterConfident(detections: Detection[], threshold: number): Detection[] {
  return detections.filter((detection) => detection.box.confidence !== null && detection.box.confidence >= threshold);
}

export function groupTracks(detections: Detection[]): Track[] {
  const byId = new Map<number, Map<number, SamBox>>();
  for (const { frame, id, box } of detections) {
    if (!byId.has(id)) byId.set(id, new Map());
    byId.get(id)!.set(frame, box);
  }
  return [...byId].map(([id, boxes]) => ({
    id,
    boxes,
    meanArea: [...boxes.values()].reduce((total, box) => total + boxArea(box), 0) / boxes.size,
  }));
}

/**
 * The car the passenger is filming: the tracked id with the most valid frames
 * and the largest area (frames × mean area), so a big car that is in view for
 * most of the clip beats both a parked car far behind and a car that only
 * crossed the frame.
 */
export function pickMainCar(cars: Detection[]): Track | null {
  const tracks = groupTracks(cars);
  if (!tracks.length) return null;
  return tracks.reduce((best, track) => (track.boxes.size * track.meanArea > best.boxes.size * best.meanArea ? track : best));
}

function centerInside(inner: SamBox, outer: SamBox) {
  const cx = (inner.x1 + inner.x2) / 2;
  const cy = (inner.y1 + inner.y2) / 2;
  return cx >= outer.x1 && cx <= outer.x2 && cy >= outer.y1 && cy <= outer.y2;
}

/**
 * The best view of the main car's plate: among plate detections whose center
 * is inside the main car's box on the same frame, the highest confidence × area.
 */
export function pickPlate(plates: Detection[], car: Track): PlatePick | null {
  let best: PlatePick | null = null;
  for (const { frame, box } of plates) {
    const carBox = car.boxes.get(frame);
    if (!carBox || !centerInside(box, carBox)) continue;
    const score = (box.confidence ?? 0) * boxArea(box);
    if (!best || score > best.score) best = { frame, box, score };
  }
  return best;
}

export type ClipFrame = { timeMs: number; width: number; height: number };

/** The extracted frame closest in time to a SAM frame index. */
export function nearestFrame<T extends ClipFrame>(frames: T[], frameIndex: number, fps: number): T | null {
  if (!frames.length || !(fps > 0)) return null;
  const targetMs = (frameIndex / fps) * 1000;
  return frames.reduce((best, frame) => (Math.abs(frame.timeMs - targetMs) < Math.abs(best.timeMs - targetMs) ? frame : best));
}

/** A SAM box (in video pixels) in the coordinates of an extracted frame of another size. */
export function scaleBox(box: SamBox, width: number, height: number): SamBox {
  const sx = width / box.w;
  const sy = height / box.h;
  return {
    x1: Math.round(box.x1 * sx),
    y1: Math.round(box.y1 * sy),
    x2: Math.round(box.x2 * sx),
    y2: Math.round(box.y2 * sy),
    w: width,
    h: height,
    confidence: box.confidence,
  };
}

/** Plate detections whose center is inside `car`'s box on the same frame. */
export function platesOnCar(plates: Detection[], car: Track): Detection[] {
  return plates.filter(({ frame, box }) => {
    const carBox = car.boxes.get(frame);
    return !!carBox && centerInside(box, carBox);
  });
}

/** SAM saw `car`'s plate within `tolerance` frames of `frameIndex`. */
export function plateOnCar(plates: Detection[], car: Track, frameIndex: number, tolerance: number) {
  return platesOnCar(plates, car).some(({ frame }) => Math.abs(frame - frameIndex) <= tolerance);
}
