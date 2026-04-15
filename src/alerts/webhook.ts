/**
 * Delivers a webhook payload with retry + exponential backoff.
 * Fails silently after maxAttempts — alerting should never crash the proxy.
 */
export async function deliverWebhook(
  url: string,
  body: unknown,
  opts: { maxAttempts?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) return false;
    } catch {
      // network / timeout; retry
    }
    if (attempt < maxAttempts) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 10_000));
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
