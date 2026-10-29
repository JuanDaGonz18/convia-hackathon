import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { ensureSupabaseConfigured, isSupabaseEnabled, supabase } from '@/lib/supabase';

/** What Muse Spark proposes for the vehicle form; null = not sure, left for the driver. */
export type VehicleSuggestion = {
  /** e.g. "Mazda". */
  brand: string | null;
  /** e.g. "3" or "CX-5"; only with a brand. */
  line: string | null;
  /** Spanish, as vehicles store it, e.g. "Plata". */
  color: string | null;
  /** e.g. "ABC123". */
  plate: string | null;
};

export type SuggestionResult =
  | { status: 'ok'; suggestion: VehicleSuggestion; mock: boolean }
  /** No vehicle, a screen, or nothing the model was sure about. */
  | { status: 'unclear'; reason: string }
  /** Offline, the function failed, or too many tries: the driver just types the data. */
  | { status: 'unavailable'; reason: string };

type FunctionResponse =
  | { status: 'ok'; suggestion: VehicleSuggestion; mock: boolean }
  | { status: 'unclear' | 'retry'; reason: string; mock: boolean };

/** Longest side sent to the model: enough to read a badge or a plate, and a small request. */
const MAX_SIDE = 1024;

const MOCK_SUGGESTION: VehicleSuggestion = { brand: 'Renault', line: 'Logan', color: 'Gris', plate: null };

/** The photo as a JPEG data URL, resized so its longest side is at most MAX_SIDE. */
async function toDataUrl(uri: string) {
  const save = async (context: ReturnType<typeof ImageManipulator.manipulate>) => {
    try {
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
      return { saved, width: image.width, height: image.height };
    } finally {
      context.release();
    }
  };
  let { saved, width, height } = await save(ImageManipulator.manipulate(uri));
  // Bigger than needed (e.g. a 1280 px vehicle photo): encode again at MAX_SIDE.
  if (Math.max(width, height) > MAX_SIDE) {
    ({ saved } = await save(ImageManipulator.manipulate(uri).resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE })));
  }
  if (!saved.base64) throw new Error('no base64');
  return `data:image/jpeg;base64,${saved.base64}`;
}

/**
 * Vehicle form autofill (Edge Function suggest-vehicle): Muse Spark reads
 * brand, line, color and, if legible, the plate from the driver's photo.
 * The photo goes inline and is not stored; the driver confirms every field.
 */
export const vehicleSuggestionService = {
  async suggest(photoUri: string): Promise<SuggestionResult> {
    if (!isSupabaseEnabled) {
      // Demo mode without a server: a fixed suggestion, so the flow can be tried.
      await new Promise((resolve) => setTimeout(resolve, 800));
      return { status: 'ok', suggestion: MOCK_SUGGESTION, mock: true };
    }
    ensureSupabaseConfigured();
    let image: string;
    try {
      image = await toDataUrl(photoUri);
    } catch {
      return { status: 'unavailable', reason: 'read_failed' };
    }
    const { data, error } = await supabase.functions.invoke<FunctionResponse>('suggest-vehicle', { body: { image } });
    if (error || !data?.status) return { status: 'unavailable', reason: 'network_error' };
    if (data.status === 'ok') return { status: 'ok', suggestion: data.suggestion, mock: data.mock };
    if (data.status === 'unclear') return { status: 'unclear', reason: data.reason };
    return { status: 'unavailable', reason: data.reason };
  },
};
