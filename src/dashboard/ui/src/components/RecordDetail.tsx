import type { AuditRecord } from "../types";

interface Props {
  record: AuditRecord;
  onBack: () => void;
}

/**
 * Full record inspector. Shows metadata, sanitized input/output JSON,
 * latency, and the hash chain links to the previous record.
 */
export function RecordDetail({ record, onBack }: Props) {
  return (
    <div className="record-detail">
      <button className="back" onClick={onBack}>
        ← back
      </button>
      <h2>
        {record.serverName}/{record.toolName}{" "}
        <span className={record.isError ? "err" : "ok"}>
          {record.isError ? "ERR" : "OK"}
        </span>
      </h2>

      <div className="meta">
        <Field label="ID" value={record.id} />
        <Field label="Method" value={record.method} />
        <Field label="Session" value={record.sessionId} />
        <Field label="Correlation" value={record.correlationId} />
        <Field
          label="User"
          value={record.userIdentity ?? "(unknown)"}
        />
        <Field label="Started" value={record.startedAt} />
        <Field label="Completed" value={record.completedAt} />
        <Field label="Latency" value={`${record.latencyMs}ms`} />
        {record.isError && record.errorMessage && (
          <Field label="Error" value={record.errorMessage} />
        )}
      </div>

      <h3>Input</h3>
      <pre>{JSON.stringify(record.inputParams, null, 2)}</pre>

      <h3>Output</h3>
      <pre>{JSON.stringify(record.outputData, null, 2)}</pre>

      <h3>Integrity</h3>
      <div className="meta">
        <Field label="content_hash" value={record.contentHash} />
        <Field label="previous_hash" value={record.previousHash ?? "(none)"} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{value}</div>
    </div>
  );
}
