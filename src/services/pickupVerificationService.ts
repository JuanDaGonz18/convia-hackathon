import { randomUUID } from 'expo-crypto';
import { fetch as streamingFetch } from 'expo/fetch';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { FunctionsHttpError } from '@supabase/supabase-js';

import type { PickupClientReason } from '@/content/pickupVerification';
import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';

export type PickupStatus = 'verified' | 'mismatch' | 'retry';
/** Real steps: the app's own upload, then what the server reports as it happens. */
export type PickupStage = 'uploading' | 'analyzing' | 'car_found' | 'plate_found' | 'reading_plate';

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

type StreamEvent =
  | { type: 'progress'; step: PickupStage }
  | { type: 'result'; status: number; body: FunctionResponse };

/** 3 s is enough for a car that has stopped, and keeps SAM's cost per check low (it bills per frame). */
export const PICKUP_CLIP_SECONDS = 3;
/** The server picks the extracted frame closest to where SAM saw the plate best. */
const FRAME_STEP_MS = 500;
const MAX_FRAMES = 11;
const FRAME_QUALITY = 0.85;
const BUCKET = 'pickup-clips';
const FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/verify-pickup`;

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

function fromResponse(data: FunctionResponse): PickupVerification {
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
}

/** HTTP refusals the screen explains; anything else is a connection problem. */
function refusal(status: number): PickupVerification {
  if (status === 404) return clientRetry('not_found');
  if (status === 409) return clientRetry('not_accepted');
  if (status === 422) return clientRetry('unsupported_vehicle');
  return clientRetry('network_error');
}

async function readBytes(uri: string) {
  return (await fetch(uri)).arrayBuffer();
}

/**
 * Asks verify-pickup for NDJSON: one line per step as the server reaches it,
 * then the result. Returns null if streaming isn't available, so the caller
 * can fall back to a plain call.
 */
async function invokeStreaming(body: unknown, onStage: (stage: PickupStage) => void): Promise<PickupVerification | null> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return clientRetry('auth_required');
  let res: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    res = await streamingFetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!res.ok) return refusal(res.status);
  const reader = res.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'progress') onStage(event.step);
      else if (event.type === 'result') return event.status === 200 && event.body?.status ? fromResponse(event.body) : refusal(event.status);
    }
    if (done) return clientRetry('network_error');
  }
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
    const folder = `${userData.user.id}/${requestId}`;
    const attempt = randomUUID();
    const clipPath = `${folder}/clip-${attempt}.mp4`;
    const uploaded: string[] = [];
    const cleanup = () => void supabase.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
    const upload = async (path: string, uri: string, contentType: string) => {
      const { error } = await supabase.storage.from(BUCKET).upload(path, await readBytes(uri), { contentType, upsert: false });
      if (error) throw error;
      uploaded.push(path);
    };

    // The clip uploads while the frames are being extracted; each frame uploads as soon as it exists.
    const uploads: Promise<void>[] = [upload(clipPath, clipUri, 'video/mp4')];
    const frames: { path: string; time_ms: number; width: number; height: number }[] = [];
    try {
      for (let timeMs = 0; frames.length < MAX_FRAMES && timeMs <= PICKUP_CLIP_SECONDS * 1000; timeMs += FRAME_STEP_MS) {
        let frame: VideoThumbnails.VideoThumbnailsResult;
        try {
          frame = await VideoThumbnails.getThumbnailAsync(clipUri, { time: timeMs, quality: FRAME_QUALITY });
        } catch (error) {
          // Past the end of the clip.
          if (!frames.length) throw error;
          break;
        }
        const path = `${folder}/frame-${attempt}-${timeMs}.jpg`;
        frames.push({ path, time_ms: timeMs, width: frame.width, height: frame.height });
        uploads.push(upload(path, frame.uri, 'image/jpeg'));
      }
    } catch {
      await Promise.allSettled(uploads);
      cleanup();
      return clientRetry('frames_failed');
    }
    try {
      await Promise.all(uploads);
    } catch {
      await Promise.allSettled(uploads);
      cleanup();
      return clientRetry('upload_failed');
    }

    const body = { request_id: requestId, clip_path: clipPath, frames };
    let result = await invokeStreaming(body, onStage).catch(() => null);
    if (!result) {
      onStage('analyzing');
      const { data, error } = await supabase.functions.invoke<FunctionResponse>('verify-pickup', { body });
      result = error || !data?.status
        ? refusal(error instanceof FunctionsHttpError ? error.context.status : 0)
        : fromResponse(data);
    }
    // The server deletes the files whenever it handles the request; if it may not have, don't leave them stored.
    if (!result.verificationId) cleanup();
    return result;
  },

  /** Flags a mismatch for review. Only the passenger, only once per result. */
  async reportMismatch(verificationId: string) {
    ensureSupabaseConfigured();
    const { error } = await supabase.rpc('report_pickup_mismatch', { p_verification_id: verificationId });
    if (error) throw error;
  },
};
