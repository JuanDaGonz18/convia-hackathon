import { randomUUID } from 'expo-crypto';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { FunctionsHttpError } from '@supabase/supabase-js';

import type { PickupClientReason } from '@/content/pickupVerification';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';

export type PickupStatus = 'verified' | 'mismatch' | 'retry';
export type PickupStage = 'uploading' | 'analyzing' | 'verifying';

export type PickupVerification = {
  /** Row id, needed to report a mismatch; null when nothing was recorded. */
  verificationId: string | null;
  status: PickupStatus;
  /** Stable code from the server (or the app); the screen translates it. */
  reason: string;
  plateRead: string | null;
  confidence: number | null;
  brandMatch: boolean | null;
  colorMatch: boolean | null;
  /** What Muse Spark saw, to explain a mismatch. */
  brandRead: string | null;
  colorRead: string | null;
  /** The trip's car, to compare with the one in front of the passenger. */
  vehicle: { plate: string; brand: string; color: string } | null;
  driver: { name: string; phone: string | null } | null;
  /** The server ran without MODEL_API_KEY and simulated the models. */
  mock: boolean;
};

type FunctionResponse = {
  verification_id: string | null;
  status: PickupStatus;
  reason: string;
  plate_read: string | null;
  confidence: number | null;
  brand_match: boolean | null;
  color_match: boolean | null;
  brand_read: string | null;
  color_read: string | null;
  vehicle: PickupVerification['vehicle'];
  driver: PickupVerification['driver'];
  mock: boolean;
};

/** 3 s is enough for a car that has stopped, and keeps SAM's cost per check low (it bills per frame). */
export const PICKUP_CLIP_SECONDS = 3;
/** The server picks the extracted frame closest to where SAM saw the plate best. */
const FRAME_STEP_MS = 500;
const MAX_FRAMES = 11;
const FRAME_QUALITY = 0.85;
/** SAM takes most of the time; after this the server is usually reading the plate. */
const VERIFYING_AFTER_MS = 6000;
const BUCKET = 'pickup-clips';

const clientRetry = (reason: PickupClientReason): PickupVerification => ({
  verificationId: null,
  status: 'retry',
  reason,
  plateRead: null,
  confidence: null,
  brandMatch: null,
  colorMatch: null,
  brandRead: null,
  colorRead: null,
  vehicle: null,
  driver: null,
  mock: false,
});

/** Frames every 0.5 s until the clip ends (the thumbnail call fails past the end). */
async function extractFrames(clipUri: string) {
  const frames: { uri: string; width: number; height: number; timeMs: number }[] = [];
  for (let timeMs = 0; frames.length < MAX_FRAMES && timeMs <= PICKUP_CLIP_SECONDS * 1000; timeMs += FRAME_STEP_MS) {
    try {
      const frame = await VideoThumbnails.getThumbnailAsync(clipUri, { time: timeMs, quality: FRAME_QUALITY });
      frames.push({ ...frame, timeMs });
    } catch (error) {
      if (!frames.length) throw error;
      break;
    }
  }
  return frames;
}

async function readBytes(uri: string) {
  return (await fetch(uri)).arrayBuffer();
}

/**
 * Pickup check (Edge Function verify-pickup): the passenger films the arriving
 * car; the clip and a frame every 0.5 s go to the private pickup-clips bucket,
 * and the server checks them with SAM 3.1 + Muse Spark, then deletes them.
 */
export const pickupVerificationService = {
  async verify(requestId: string, clipUri: string, onStage: (stage: PickupStage) => void): Promise<PickupVerification> {
    if (!isSupabaseEnabled) return clientRetry('offline');
    ensureSupabaseConfigured();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return clientRetry('auth_required');

    onStage('uploading');
    let frames: Awaited<ReturnType<typeof extractFrames>>;
    try {
      frames = await extractFrames(clipUri);
    } catch {
      return clientRetry('frames_failed');
    }

    const folder = `${userData.user.id}/${requestId}`;
    const attempt = randomUUID();
    const clipPath = `${folder}/clip-${attempt}.mp4`;
    const framePaths = frames.map((frame) => `${folder}/frame-${attempt}-${frame.timeMs}.jpg`);
    const uploaded: string[] = [];
    const cleanup = () => void supabase.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
    try {
      const files = [
        { path: clipPath, uri: clipUri, contentType: 'video/mp4' },
        ...frames.map((frame, index) => ({ path: framePaths[index], uri: frame.uri, contentType: 'image/jpeg' })),
      ];
      await Promise.all(files.map(async (file) => {
        const bytes = await readBytes(file.uri);
        const { error } = await supabase.storage.from(BUCKET).upload(file.path, bytes, { contentType: file.contentType, upsert: false });
        if (error) throw error;
        uploaded.push(file.path);
      }));
    } catch {
      cleanup();
      return clientRetry('upload_failed');
    }

    onStage('analyzing');
    const verifyingTimer = setTimeout(() => onStage('verifying'), VERIFYING_AFTER_MS);
    const { data, error } = await supabase.functions.invoke<FunctionResponse>('verify-pickup', {
      body: {
        request_id: requestId,
        clip_path: clipPath,
        frames: frames.map((frame, index) => ({ path: framePaths[index], time_ms: frame.timeMs, width: frame.width, height: frame.height })),
      },
    }).finally(() => clearTimeout(verifyingTimer));

    if (error || !data?.status) {
      // The server deletes the files when it handles the request; if it never did, don't leave them stored.
      cleanup();
      const status = error instanceof FunctionsHttpError ? error.context.status : 0;
      if (status === 404) return clientRetry('not_found');
      if (status === 409) return clientRetry('not_accepted');
      if (status === 422) return clientRetry('unsupported_vehicle');
      return clientRetry('network_error');
    }
    return {
      verificationId: data.verification_id,
      status: data.status,
      reason: data.reason,
      plateRead: data.plate_read,
      confidence: data.confidence,
      brandMatch: data.brand_match,
      colorMatch: data.color_match,
      brandRead: data.brand_read,
      colorRead: data.color_read,
      vehicle: data.vehicle,
      driver: data.driver,
      mock: data.mock,
    };
  },

  /** Flags a mismatch for review. Only the passenger, only once per result. */
  async reportMismatch(verificationId: string) {
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('report_pickup_mismatch', { p_verification_id: verificationId });
    if (error) throw error;
  },
};
