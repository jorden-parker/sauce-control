import {
  currentComparisonSnapshot,
  subscribeComparison,
} from "@/comparison/current-comparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A subscription observes the process-owned Comparison; disconnecting never stops it. */
export const GET = (request: Request): Response => {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const encoder = new TextEncoder();
  let flush: (() => void) | undefined, dispose: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      dispose?.();
    },
    pull() {
      flush?.();
    },
    start(controller) {
      let closed = false;
      let dirty = true;
      const send = () => {
        if (closed || !dirty || (controller.desiredSize ?? 0) <= 0) return;
        dirty = false;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify(currentComparisonSnapshot())}\n\n`
          )
        );
      };
      flush = send;
      const update = () => {
        dirty = true;
        send();
      };
      const unsubscribe = subscribeComparison(update);
      const heartbeat = setInterval(update, 15_000);
      dispose = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        dispose?.();
        controller.close();
      };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      else send();
    },
  });
  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store, no-transform",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
};
