import { useState } from "react";
import type { AuditRecord } from "../types";
import { fetchRecords } from "../api";
import { RecordTable } from "./RecordTable";

interface Props {
  onSelect: (r: AuditRecord) => void;
}

/**
 * Server-side search. Issues a /api/records query with `q=` (full-text on
 * tool name, input params, output data) so results aren't bounded by the
 * 200-row live cache.
 */
export function SearchView({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function runSearch(): Promise<void> {
    if (!query.trim()) return;
    setLoading(true);
    setError(undefined);
    try {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("limit", "200");
      setResults(await fetchRecords(params));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <input
          placeholder="search tool name or payload contents..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
        />
        <button onClick={() => void runSearch()} disabled={loading}>
          {loading ? "searching…" : "search"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <RecordTable records={results} onSelectRecord={onSelect} />
    </div>
  );
}
