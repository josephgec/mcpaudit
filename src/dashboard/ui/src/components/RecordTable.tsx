import type { AuditRecord } from "../types";

interface Props {
  records: AuditRecord[];
  onSelectRecord: (r: AuditRecord) => void;
  onSessionClick?: (id: string) => void;
}

/**
 * Reusable record table used by the Live feed, Search view, and Session view.
 * Rows are clickable to open the RecordDetail panel.
 */
export function RecordTable({ records, onSelectRecord, onSessionClick }: Props) {
  if (records.length === 0) {
    return <div className="muted">no records</div>;
  }
  return (
    <table className="record-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Server</th>
          <th>Tool</th>
          <th>Latency</th>
          <th>Status</th>
          <th>Session</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.id} onClick={() => onSelectRecord(r)}>
            <td>{r.startedAt.slice(11, 19)}</td>
            <td>{r.serverName}</td>
            <td>{r.toolName}</td>
            <td>{r.latencyMs}ms</td>
            <td className={r.isError ? "err" : "ok"}>
              {r.isError ? "ERR" : "OK"}
            </td>
            <td>
              {onSessionClick ? (
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSessionClick(r.sessionId);
                  }}
                >
                  {r.sessionId.slice(-8)}
                </button>
              ) : (
                r.sessionId.slice(-8)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
