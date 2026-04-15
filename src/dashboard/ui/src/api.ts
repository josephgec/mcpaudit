import type { AuditRecord, StatsResult } from "./types";

const base = "";

export async function fetchRecords(params: URLSearchParams): Promise<AuditRecord[]> {
  const r = await fetch(`${base}/api/records?${params.toString()}`);
  if (!r.ok) throw new Error(`records ${r.status}`);
  const body = (await r.json()) as { records: AuditRecord[] };
  return body.records;
}

export async function fetchStats(params: URLSearchParams): Promise<StatsResult> {
  const r = await fetch(`${base}/api/stats?${params.toString()}`);
  if (!r.ok) throw new Error(`stats ${r.status}`);
  return (await r.json()) as StatsResult;
}

export async function fetchSession(sessionId: string): Promise<AuditRecord[]> {
  const r = await fetch(`${base}/api/session?id=${encodeURIComponent(sessionId)}`);
  if (!r.ok) throw new Error(`session ${r.status}`);
  const body = (await r.json()) as { records: AuditRecord[] };
  return body.records;
}

/**
 * Subscribes to the dashboard's SSE stream of newly-appended records.
 * Returns an unsubscribe function. Fires `onRecord` for each event and
 * `onStatusChange` for connection lifecycle.
 */
export function subscribeLive(
  onRecord: (r: AuditRecord) => void,
  onStatusChange: (status: "connecting" | "live" | "disconnected") => void,
): () => void {
  onStatusChange("connecting");
  const es = new EventSource(`${base}/api/live`);
  es.onopen = () => onStatusChange("live");
  es.onerror = () => onStatusChange("disconnected");
  es.onmessage = (ev) => {
    try {
      const r = JSON.parse(ev.data) as AuditRecord;
      onRecord(r);
    } catch {
      // ignore malformed event
    }
  };
  return () => {
    es.close();
    onStatusChange("disconnected");
  };
}
