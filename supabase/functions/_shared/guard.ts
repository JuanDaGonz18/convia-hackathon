/**
 * Request guards shared by the Edge Functions: fail-closed mock mode and a
 * size cap on JSON bodies. Pure functions (no Deno globals) so Node can test them.
 */

export type ModelMode = 'live' | 'mock' | 'unavailable';

/**
 * Mock mode only when ALLOW_MOCK is exactly 'true' and there is no model key.
 * A missing key without ALLOW_MOCK means the function must refuse (503), so a
 * lost secret never turns real verifications into simulated ones.
 */
export function modelMode(apiKey: string | undefined, allowMock: string | undefined): ModelMode {
  if (apiKey?.trim()) return 'live';
  return allowMock === 'true' ? 'mock' : 'unavailable';
}

export const MB = 1024 * 1024;

export type BodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413; error: 'INVALID_BODY' | 'PAYLOAD_TOO_LARGE' };

const TOO_LARGE = { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' } as const;
const INVALID = { ok: false, status: 400, error: 'INVALID_BODY' } as const;

/**
 * Parses a JSON body of at most `maxBytes`. A Content-Length above the cap is
 * refused before reading; the stream is also counted, so a missing or false
 * header cannot get a bigger body through.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return TOO_LARGE;
  if (!request.body) return INVALID;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body !== null && typeof body === 'object' ? { ok: true, body } : INVALID;
  } catch {
    return INVALID;
  }
}
