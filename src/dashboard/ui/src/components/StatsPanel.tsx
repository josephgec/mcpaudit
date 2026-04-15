import type { StatsResult } from "../types";

interface Props {
  stats: StatsResult | undefined;
}

export function StatsPanel({ stats }: Props) {
  if (!stats) {
    return (
      <div className="card">
        <h2>Summary (last 24h)</h2>
        <div className="muted">loading…</div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2>Summary (last 24h)</h2>
        <Row label="Total calls" value={stats.totalCalls} />
        <Row
          label="Errors"
          value={`${stats.errorCount} (${(stats.errorRate * 100).toFixed(1)}%)`}
        />
        <Row label="p50 latency" value={`${stats.p50LatencyMs}ms`} />
        <Row label="p95 latency" value={`${stats.p95LatencyMs}ms`} />
        <Row label="p99 latency" value={`${stats.p99LatencyMs}ms`} />
      </div>

      <div className="card">
        <h2>Top tools</h2>
        {stats.topTools.length === 0 ? (
          <div className="muted">no calls yet</div>
        ) : (
          stats.topTools.map((t) => (
            <Row key={t.tool} label={t.tool} value={t.count} />
          ))
        )}
      </div>

      <div className="card">
        <h2>Top servers</h2>
        {stats.topServers.length === 0 ? (
          <div className="muted">no calls yet</div>
        ) : (
          stats.topServers.map((t) => (
            <Row key={t.server} label={t.server} value={t.count} />
          ))
        )}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
