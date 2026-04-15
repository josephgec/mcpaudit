import { useEffect, useMemo, useState } from "react";
import type { AuditRecord, StatsResult, View } from "./types";
import { fetchRecords, fetchSession, fetchStats, subscribeLive } from "./api";
import { LiveFeed } from "./components/LiveFeed";
import { StatsPanel } from "./components/StatsPanel";
import { SearchView } from "./components/SearchView";
import { SessionView } from "./components/SessionView";
import { RecordDetail } from "./components/RecordDetail";

export function App() {
  const [view, setView] = useState<View>("live");
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [stats, setStats] = useState<StatsResult | undefined>();
  const [status, setStatus] = useState<"connecting" | "live" | "disconnected">(
    "connecting",
  );
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | undefined>();
  const [selectedSession, setSelectedSession] = useState<string | undefined>();
  const [sessionRecords, setSessionRecords] = useState<AuditRecord[]>([]);

  // Bootstrap initial state.
  useEffect(() => {
    void loadInitial();
  }, []);

  // Refresh stats every 15s.
  useEffect(() => {
    const t = setInterval(() => void refreshStats(), 15_000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to the live SSE feed for new records.
  useEffect(() => {
    return subscribeLive(
      (r) => {
        setRecords((prev) => {
          if (prev.some((x) => x.id === r.id)) return prev;
          const next = [...prev, r];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      },
      setStatus,
    );
  }, []);

  // Re-fetch session timeline when user picks a session.
  useEffect(() => {
    if (!selectedSession) return;
    void (async () => {
      try {
        const rows = await fetchSession(selectedSession);
        setSessionRecords(rows);
      } catch {
        setSessionRecords([]);
      }
    })();
  }, [selectedSession]);

  async function loadInitial(): Promise<void> {
    const params = new URLSearchParams();
    params.set("limit", "200");
    try {
      const [recs, st] = await Promise.all([
        fetchRecords(params),
        fetchStats(buildLast24hParams()),
      ]);
      setRecords(recs);
      setStats(st);
    } catch {
      // network or permission issue; UI handles missing data gracefully
    }
  }

  async function refreshStats(): Promise<void> {
    try {
      setStats(await fetchStats(buildLast24hParams()));
    } catch {}
  }

  const sessions = useMemo(() => groupBySession(records), [records]);

  function openRecord(r: AuditRecord): void {
    setSelectedRecord(r);
    setView("record");
  }

  function openSession(id: string): void {
    setSelectedSession(id);
    setView("sessions");
  }

  return (
    <div className="app">
      <header className="header">
        <h1>mcpaudit</h1>
        <span className={`status status-${status}`}>{status}</span>
        <nav className="nav">
          <button
            className={view === "live" ? "active" : ""}
            onClick={() => setView("live")}
          >
            Live
          </button>
          <button
            className={view === "sessions" ? "active" : ""}
            onClick={() => setView("sessions")}
          >
            Sessions
          </button>
          <button
            className={view === "search" ? "active" : ""}
            onClick={() => setView("search")}
          >
            Search
          </button>
        </nav>
      </header>

      <main className="main">
        <aside className="sidebar">
          <StatsPanel stats={stats} />
        </aside>

        <section className="content">
          {view === "live" && (
            <LiveFeed records={records} onSelect={openRecord} onSessionClick={openSession} />
          )}
          {view === "sessions" && (
            <SessionView
              sessions={sessions}
              selected={selectedSession}
              records={sessionRecords}
              onSelectSession={openSession}
              onSelectRecord={openRecord}
            />
          )}
          {view === "search" && <SearchView onSelect={openRecord} />}
          {view === "record" && selectedRecord && (
            <RecordDetail
              record={selectedRecord}
              onBack={() => setView("live")}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function buildLast24hParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set("from", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return p;
}

function groupBySession(records: AuditRecord[]): Map<string, AuditRecord[]> {
  const map = new Map<string, AuditRecord[]>();
  for (const r of records) {
    const arr = map.get(r.sessionId) ?? [];
    arr.push(r);
    map.set(r.sessionId, arr);
  }
  return map;
}
