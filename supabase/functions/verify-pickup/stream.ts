/**
 * The NDJSON answer of a check (progress lines, then the result), written so the clean-up always
 * runs. If the app disconnects while the answer is being streamed, writing to the stream throws;
 * before this, that skipped deleting the clip and saving the result. Now a failed write only stops
 * the writing, `after()` runs in a `finally`, and `keepAlive` (EdgeRuntime.waitUntil in the
 * function) lets it finish after the response is gone. Pure TypeScript, unit-tested.
 */
export function ndjsonStream<T extends { after: () => Promise<void> }>(
  work: (send: (event: unknown) => void) => Promise<T>,
  result: (outcome: T) => unknown,
  keepAlive: (pending: Promise<unknown>) => void = () => undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!open) return;
        const line = encoder.encode(`${JSON.stringify(event)}\n`);
        try {
          controller.enqueue(line);
        } catch {
          // The app is gone: stop writing, but keep going to the clean-up.
          open = false;
        }
      };
      const done = (async () => {
        let outcome: T | null = null;
        try {
          outcome = await work(send);
          // The passenger gets the answer first; saving the row and deleting the files happen after.
          send(result(outcome));
        } finally {
          try {
            await outcome?.after();
          } finally {
            open = false;
            try { controller.close(); } catch { /* already closed or cancelled by the client */ }
          }
        }
      })();
      const settled = done.catch(() => undefined);
      keepAlive(settled);
      return settled;
    },
    cancel() {
      open = false;
    },
  });
}
