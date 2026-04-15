import type { AuditRecord } from "../types";
import { RecordTable } from "./RecordTable";

interface Props {
  sessions: Map<string, AuditRecord[]>;
  selected: string | undefined;
  records: AuditRecord[];
  onSelectSession: (id: string) => void;
  onSelectRecord: (r: AuditRecord) => void;
}

/**
 * Two-pane session browser: a list of sessions on the left (ordered by
 * most recent activity) and the selected session's reconstructed call
 * timeline on the right.
 */
export function SessionView({
  sessions,
  selected,
  records,
  onSelectSession,
  onSelectRecord,
}: Props) {
  const ordered = [...sessions.entries()]
    .map(([id, recs]) => ({
      id,
      count: recs.length,
      latest: recs[recs.length - 1]?.startedAt ?? "",
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest));

  return (
    <div className="session-view">
      <div className="session-list">
        <h3>Sessions ({ordered.length})</h3>
        {ordered.length === 0 && <div className="muted">no sessions yet</div>}
        {ordered.map((s) => (
          <button
            key={s.id}
            className={`session-row ${selected === s.id ? "active" : ""}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="session-id">{s.id.slice(-12)}</div>
            <div className="session-meta">
              {s.count} calls · {s.latest.slice(11, 19)}
            </div>
          </button>
        ))}
      </div>
      <div className="session-timeline">
        {selected ? (
          <>
            <h3>Timeline · {selected.slice(-12)}</h3>
            <RecordTable records={records} onSelectRecord={onSelectRecord} />
          </>
        ) : (
          <div className="muted">pick a session</div>
        )}
      </div>
    </div>
  );
}
