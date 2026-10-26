// Runs verify-pickup's pipeline on real clips with the real Meta Model API, and
// shows how the SAM confidence threshold changes what is selected.
//
// Clips live in test-clips/ (gitignored: they show real plates) with a manifest:
//   test-clips/clips.json → [{ "file": "logan-front.mp4", "plate": "ABC123", "brand": "Renault Logan",
//                              "color": "Gris", "expected": "verified" }, ...]
// Each clip is first turned into what the app records (3 s from the middle, 720p, 2.5 Mbps, no audio),
// then frames are extracted every 0.5 s, as the app does with expo-video-thumbnails.
//
// Usage: node scripts/pickup-real-test.mjs [--min-confidence 0.5] [--effort low] [--seconds 3] [--only file.mp4]
//        node scripts/pickup-real-test.mjs --replay test-clips/results-….json
//          re-decides a previous run with the current clips.json (fixed plates/colors), without calling the API.
// Needs MODEL_API_KEY in supabase/functions/.env and ffmpeg/ffprobe (or FFMPEG_DIR).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decidePickup } from '../supabase/functions/verify-pickup/decision.ts';
import { analyzeClip } from '../supabase/functions/verify-pickup/pipeline.ts';
import { createModelClient } from '../supabase/functions/verify-pickup/model.ts';
import { filterConfident, parseSamVideo, pickMainCar, pickPlate } from '../supabase/functions/verify-pickup/tracks.ts';

const CLIPS_DIR = 'test-clips';
const THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
// Prices from https://dev.meta.ai/docs/pricing-rate-limits (USD).
const SAM_PER_FRAME = 0.20 / 1000;
const MUSE_IN_PER_TOKEN = 1.25 / 1e6;
const MUSE_OUT_PER_TOKEN = 4.25 / 1e6;

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const minConfidence = Number(arg('--min-confidence', '0.5'));
const effort = arg('--effort', 'low');
const only = arg('--only', null);
const seconds = Number(arg('--seconds', '3'));
const replay = arg('--replay', null);

function calibrate(carText, plateText) {
  const cars = parseSamVideo(carText ?? '');
  const plates = parseSamVideo(plateText ?? '');
  return Object.fromEntries(THRESHOLDS.map((threshold) => {
    const car = pickMainCar(filterConfident(cars, threshold));
    const plate = car ? pickPlate(filterConfident(plates, threshold), car) : null;
    return [threshold, car ? `car#${car.id}×${car.boxes.size}${plate ? ` plate@${plate.frame}` : ' no-plate'}` : 'no-car'];
  }));
}

if (replay) {
  const previous = JSON.parse(readFileSync(replay, 'utf8'));
  const clips = Object.fromEntries(JSON.parse(readFileSync(join(CLIPS_DIR, 'clips.json'), 'utf8')).map((clip) => [clip.file, clip]));
  let ok = 0;
  for (const row of previous.rows) {
    const clip = clips[row.file];
    if (!clip || !row.report) { console.log(`---- ${row.file}: ${row.status ?? 'error'}/${row.reason ?? row.error} (no Muse reading to re-decide)`); continue; }
    const decision = decidePickup(row.report, { plate: clip.plate, brand: clip.brand, color: clip.color });
    const hit = clip.expected === decision.status;
    ok += hit ? 1 : 0;
    console.log(`${hit ? 'OK  ' : 'MISS'} ${row.file}: ${decision.status}/${decision.reason} read=${decision.plateRead ?? '-'} brand=${row.report.brand}(${row.report.brand_confidence}) color=${row.report.color}(${row.report.color_confidence}) expected=${clip.expected}`);
  }
  console.log(`
${ok}/${previous.rows.length} as expected (replayed at min-confidence ${previous.minConfidence})`);
  process.exit(0);
}

const env = Object.fromEntries(readFileSync('supabase/functions/.env', 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
if (!env.MODEL_API_KEY) throw new Error('MODEL_API_KEY missing in supabase/functions/.env');

const manifestPath = join(CLIPS_DIR, 'clips.json');
if (!existsSync(manifestPath)) {
  console.error(`Missing ${manifestPath}. Clips found: ${existsSync(CLIPS_DIR) ? readdirSync(CLIPS_DIR).join(', ') : '(no folder)'}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')).filter((clip) => !only || clip.file === only);

const bin = (name) => (process.env.FFMPEG_DIR ? join(process.env.FFMPEG_DIR, name) : name);

/** What the app records: `seconds` from the middle of the clip, 720p (short side), 2.5 Mbps H.264, muted. */
function asAppClip(clipPath, dir) {
  const duration = Number(execFileSync(bin('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clipPath], { encoding: 'utf8' }).trim());
  const start = Math.max(0, (duration - seconds) / 2);
  const out = join(dir, 'app-clip.mp4');
  execFileSync(bin('ffmpeg'), ['-v', 'error', '-y', '-ss', String(start), '-t', String(seconds), '-i', clipPath,
    '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'", '-c:v', 'libx264', '-b:v', '2500k', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', out]);
  return out;
}

function extractFrames(clipPath, dir) {
  execFileSync(bin('ffmpeg'), ['-v', 'error', '-y', '-i', clipPath, '-vf', 'fps=2', '-q:v', '3', join(dir, 'f-%03d.jpg')]);
  const [width, height] = execFileSync(bin('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', clipPath], { encoding: 'utf8' })
    .trim().split('x').map(Number);
  // ffmpeg applies the rotation flag when extracting, so a portrait clip gives portrait frames.
  const rotated = execFileSync(bin('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_side_data=rotation', '-of', 'csv=p=0', clipPath], { encoding: 'utf8' }).trim();
  const [w, h] = Math.abs(Number(rotated)) === 90 ? [height, width] : [width, height];
  return readdirSync(dir).filter((name) => name.endsWith('.jpg')).sort().map((name, index) => ({
    timeMs: index * 500,
    width: w,
    height: h,
    load: async () => new Uint8Array(readFileSync(join(dir, name))),
  }));
}

const rows = [];
for (const clip of manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'pickup-'));
  const usage = [];
  const sam = {};
  try {
    const clipPath = asAppClip(join(CLIPS_DIR, clip.file), dir);
    const frames = extractFrames(clipPath, dir);
    const base = createModelClient({
      apiKey: env.MODEL_API_KEY,
      baseUrl: env.MODEL_API_BASE_URL || undefined,
      reasoningEffort: effort,
      log: (event, data) => { if (event === 'model_usage') usage.push(data); },
    });
    // Keep SAM's raw answers to replay the selection at other thresholds without paying again.
    const client = { ...base, async segmentVideo(fileId, prompt) { const result = await base.segmentVideo(fileId, prompt); sam[prompt] = result.text; return result; } };
    const registered = { plate: clip.plate, brand: clip.brand, color: clip.color };
    const result = await analyzeClip({ video: new Uint8Array(readFileSync(clipPath)), frames }, registered, client, { minConfidence, maxDurationS: 5 });

    const museUsage = usage.find((entry) => entry.call === 'muse:read_plate')?.usage;
    const cost = (result.framesProcessed ?? 0) * SAM_PER_FRAME
      + (museUsage ? museUsage.prompt_tokens * MUSE_IN_PER_TOKEN + museUsage.completion_tokens * MUSE_OUT_PER_TOKEN : 0);
    const calibration = calibrate(sam.car, sam['license plate']);
    const row = {
      file: clip.file,
      expected: clip.expected,
      status: result.decision.status,
      reason: result.decision.reason,
      ok: clip.expected ? clip.expected === result.decision.status : null,
      plateRead: result.decision.plateRead,
      confidence: result.decision.confidence,
      totalMs: Object.values(result.timings).reduce((total, ms) => total + ms, 0),
      timings: result.timings,
      framesProcessed: result.framesProcessed,
      museTokens: museUsage ? { in: museUsage.prompt_tokens, out: museUsage.completion_tokens } : null,
      costUsd: Number(cost.toFixed(5)),
      calibration,
      report: result.report,
      // Raw SAM answers without mask payloads, to replay the selection later.
      sam: Object.fromEntries(Object.entries(sam).map(([prompt, text]) => [prompt, text.replace(/<\|mask;[^|]*\|>/g, '')])),
      debug: result.debug,
    };
    rows.push(row);
    console.log(`${row.ok === false ? 'MISS' : row.ok ? 'OK  ' : '    '} ${clip.file}: ${row.status}/${row.reason} read=${row.plateRead ?? '-'} ${row.totalMs}ms $${row.costUsd}`);
    console.log(`     timings ${JSON.stringify(row.timings)}  thresholds ${JSON.stringify(calibration)}`);
  } catch (error) {
    rows.push({ file: clip.file, error: String(error) });
    console.log(`ERR  ${clip.file}: ${error}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scored = rows.filter((row) => row.ok !== null && row.ok !== undefined);
const costs = rows.filter((row) => row.costUsd !== undefined).map((row) => row.costUsd);
console.log(`\n${scored.filter((row) => row.ok).length}/${scored.length} as expected at min-confidence ${minConfidence}, effort ${effort}`);
if (costs.length) console.log(`cost per verification: mean $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}, max $${Math.max(...costs).toFixed(4)}`);
const out = join(CLIPS_DIR, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ minConfidence, effort, seconds, rows }, null, 2));
console.log(`details: ${out} (gitignored)`);
