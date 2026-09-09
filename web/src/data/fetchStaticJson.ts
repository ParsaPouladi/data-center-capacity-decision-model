/**
 * Fetch and parse one committed, same-origin static JSON asset (the files the
 * app serves from `/data/`), with a single retry for a transient failure.
 *
 * A transient failure is one of:
 *   - a `fetch()` rejection with no HTTP response at all — the browser could
 *     not complete the request (a dropped connection, a brief DNS/TLS hiccup,
 *     a background tab throttled at the wrong moment);
 *   - an HTTP 502 / 503 / 504 from the edge or origin.
 * Either one is retried exactly once, after a short pause. Two attempts at
 * most, ever — there is no back-off loop and no third try.
 *
 * Everything else is returned on the first attempt:
 *   - an ordinary 4xx is a definitive answer, not a blip, so it is surfaced
 *     immediately;
 *   - a JSON parse error is on a response the server *did* deliver, and the
 *     same bytes would parse the same way on a retry, so it is not retried.
 */

const RETRY_DELAY_MS = 600;

/** Gateway statuses a static asset can briefly return while the edge or
 * origin is between states; all are safe to request once more. */
function isTransientHttpStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function fetchStaticJson<T>(path: string): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const isLastAttempt = attempt === 2;

    let response: Response;
    try {
      response = await fetch(path);
    } catch (err) {
      // No HTTP response: retry once, then let the rejection propagate so the
      // caller can present its own failure state.
      if (isLastAttempt) throw err;
      await pause(RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      if (!isLastAttempt && isTransientHttpStatus(response.status)) {
        await pause(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`${response.status} ${response.statusText}`);
    }

    // A JSON parse failure here rejects the returned promise directly — it is
    // never retried (see the module comment).
    return (await response.json()) as T;
  }

  // Unreachable: the loop always returns or throws on the second attempt.
  throw new Error(`Could not load ${path}`);
}
