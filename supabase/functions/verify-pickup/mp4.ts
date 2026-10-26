/**
 * Reads the first video track of an MP4/MOV: frame count, duration and fps.
 * Edge Functions can't run ffmpeg; this is enough to turn a SAM frame index
 * into a time, and to reject long clips before paying for them.
 * No Deno APIs, so it can be unit-tested with Node.
 */

export type VideoInfo = {
  frameCount: number;
  durationS: number;
  fps: number;
  /** From the ftyp brand: iPhones record QuickTime (.mov), Android records MP4. */
  mimeType: 'video/mp4' | 'video/quicktime';
};

type Box = { type: string; start: number; end: number };

function readBoxes(view: DataView, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset + 4, 4));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function child(view: DataView, parent: Box, type: string) {
  return readBoxes(view, parent.start, parent.end).find((box) => box.type === type);
}

function trackInfo(view: DataView, trak: Box): VideoInfo | null {
  const mdia = child(view, trak, 'mdia');
  if (!mdia) return null;
  const hdlr = child(view, mdia, 'hdlr');
  // hdlr: version/flags (4), pre_defined (4), handler_type (4).
  if (!hdlr || hdlr.end - hdlr.start < 12) return null;
  const handler = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + hdlr.start + 8, 4));
  if (handler !== 'vide') return null;

  const mdhd = child(view, mdia, 'mdhd');
  if (!mdhd) return null;
  const version = view.getUint8(mdhd.start);
  const timescale = version === 1 ? view.getUint32(mdhd.start + 20) : view.getUint32(mdhd.start + 12);
  const duration = version === 1 ? Number(view.getBigUint64(mdhd.start + 24)) : view.getUint32(mdhd.start + 16);

  const stbl = (() => {
    const minf = child(view, mdia, 'minf');
    return minf ? child(view, minf, 'stbl') : undefined;
  })();
  const stts = stbl ? child(view, stbl, 'stts') : undefined;
  if (!stts || !timescale || !duration) return null;
  // stts: version/flags (4), entry_count (4), then (sample_count, sample_delta) pairs.
  const entries = view.getUint32(stts.start + 4);
  let frameCount = 0;
  for (let index = 0; index < entries; index++) {
    const at = stts.start + 8 + index * 8;
    if (at + 8 > stts.end) return null;
    frameCount += view.getUint32(at);
  }
  const durationS = duration / timescale;
  if (!frameCount || !durationS) return null;
  return { frameCount, durationS, fps: frameCount / durationS, mimeType: 'video/mp4' };
}

/** Info about the first video track, or null if this isn't a readable MP4/MOV. */
export function readVideoInfo(bytes: Uint8Array): VideoInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const top = readBoxes(view, 0, bytes.byteLength);
    const moov = top.find((box) => box.type === 'moov');
    if (!moov) return null;
    const ftyp = top.find((box) => box.type === 'ftyp');
    const brand = ftyp && ftyp.end - ftyp.start >= 4 ? String.fromCharCode(...bytes.subarray(ftyp.start, ftyp.start + 4)) : '';
    for (const trak of readBoxes(view, moov.start, moov.end).filter((box) => box.type === 'trak')) {
      const info = trackInfo(view, trak);
      if (info) return { ...info, mimeType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
    }
    return null;
  } catch {
    // Truncated or malformed boxes.
    return null;
  }
}
