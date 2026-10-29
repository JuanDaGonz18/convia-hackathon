/**
 * Student-card privacy, on the phone: the photo is never sent whole. Only crops of the card
 * AROUND the face (left, right, above, below the face box plus a margin) go to the server, so
 * no face pixels leave the phone. The face box comes from the same upright image the crops are
 * cut from, so no coordinate mapping is involved.
 *
 * Pure TypeScript (no React Native), unit-tested with Node.
 */

export type Box = { x: number; y: number; width: number; height: number };
/** A crop as start/end corners, the shape nitro-image's crop() takes. */
export type Region = { startX: number; startY: number; endX: number; endY: number; side: 'left' | 'right' | 'top' | 'bottom' };

/** Margin around the face box, as a share of the face's larger side (hair, ears, shoulders). */
export const FACE_MARGIN = 0.25;
/** A crop thinner than this share of the image can't hold a readable line of text. */
export const MIN_SIDE = 0.12;

/** The face box grown by the margin and clamped to the image. */
export function excludedBox(face: Box, width: number, height: number) {
  const margin = FACE_MARGIN * Math.max(face.width, face.height);
  return {
    x0: Math.max(0, Math.floor(face.x - margin)),
    y0: Math.max(0, Math.floor(face.y - margin)),
    x1: Math.min(width, Math.ceil(face.x + face.width + margin)),
    y1: Math.min(height, Math.ceil(face.y + face.height + margin)),
  };
}

/**
 * The parts of the image that don't touch the (grown) face box: full-height strips to its left
 * and right, and the column above and below it. Strips too thin to hold text are dropped.
 */
export function regionsAroundFace(face: Box, width: number, height: number): Region[] {
  const { x0, y0, x1, y1 } = excludedBox(face, width, height);
  const candidates: Region[] = [
    { side: 'left', startX: 0, startY: 0, endX: x0, endY: height },
    { side: 'right', startX: x1, startY: 0, endX: width, endY: height },
    { side: 'top', startX: x0, startY: 0, endX: x1, endY: y0 },
    { side: 'bottom', startX: x0, startY: y1, endX: x1, endY: height },
  ];
  return candidates.filter((region) => {
    const w = region.endX - region.startX;
    const h = region.endY - region.startY;
    return w >= MIN_SIDE * width && h >= MIN_SIDE * height;
  });
}

/** True when the two rectangles share any pixel. */
export function overlaps(region: Region, box: { x0: number; y0: number; x1: number; y1: number }) {
  return region.startX < box.x1 && region.endX > box.x0 && region.startY < box.y1 && region.endY > box.y0;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of raw bytes (Hermes has no Buffer, and btoa needs a binary string). */
export function toBase64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}
