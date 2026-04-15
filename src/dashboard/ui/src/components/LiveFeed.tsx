import { useState } from "react";
import type { AuditRecord } from "../types";
import { RecordTable } from "./RecordTable";

interface Props {
  records: AuditRecord[];
  onSelect: (r: AuditRecord) => void;
  onSessionClick: (id: string) => void;
}

export function LiveFeed({ records, onSelect, onSessionClick }: Props) {
  const [filter, setFilter] = useState("");
  const filtered = filter
    ? records.filter((r) => matches(r, filter))
    : records;

  // Show newest first, cap to 200 to keep render snappy.
  const view = filtered.slice(-200).reverse();

  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="filter tool, server, session..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">{filtered.length} records</span>
      </div>
      <RecordTable
        records={view}
        onSelectRecord={onSelect}
        onSessionClick={onSessionClick}
      />
    </div>
  );
}

function matches(r: AuditRecord, q: string): boolean {
  const lc = q.toLowerCase();
  return (
    r.toolName.toLowerCase().includes(lc) ||
    r.serverName.toLowerCase().includes(lc) ||
    r.sessionId.toLowerCase().includes(lc) ||
    r.id.toLowerCase().includes(lc)
  );
}
