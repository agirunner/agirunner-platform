import type {
  DashboardProjectRecord,
  DashboardResolvedDocumentReference,
} from '../lib/api.js';
import type { DashboardProjectMemoryEntry } from './pipeline-detail-support.js';

export function PipelineDocumentsCard(props: {
  isLoading: boolean;
  hasError: boolean;
  documents: DashboardResolvedDocumentReference[];
}) {
  return (
    <div className="card">
      <h3>Pipeline Documents</h3>
      <p className="muted">Reference material available to workers in this pipeline.</p>
      {props.isLoading ? <p>Loading documents...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load pipeline documents.</p> : null}
      <div className="grid">
        {props.documents.map((document) => (
          <article key={document.logical_name} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{document.title ?? document.logical_name}</strong>
              <span className="status-badge">{document.scope}</span>
            </div>
            <p className="muted">{document.description ?? document.source}</p>
            <div className="row">
              <span className="status-badge">Source: {document.source}</span>
              {document.task_id ? <span className="status-badge">Task: {document.task_id}</span> : null}
            </div>
            {document.repository && document.path ? <p className="muted">{document.repository}:{document.path}</p> : null}
            {document.url ? <a href={document.url} target="_blank" rel="noreferrer">Open external reference</a> : null}
            {document.artifact ? <a href={document.artifact.download_url}>Download artifact-backed document</a> : null}
          </article>
        ))}
        {props.documents.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="muted">No pipeline documents registered yet.</p>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectMemoryCard(props: {
  project?: DashboardProjectRecord;
  entries: DashboardProjectMemoryEntry[];
  isLoading: boolean;
  hasError: boolean;
  memoryKey: string;
  memoryValue: string;
  memoryError?: string | null;
  memoryMessage?: string | null;
  onMemoryKeyChange(value: string): void;
  onMemoryValueChange(value: string): void;
  onSave(): void;
}) {
  return (
    <div className="card">
      <h3>Project Memory</h3>
      <p className="muted">Operator-visible shared memory for future runs and workers.</p>
      {props.isLoading ? <p>Loading project memory...</p> : null}
      {props.hasError ? <p style={{ color: '#dc2626' }}>Failed to load project memory.</p> : null}
      {props.project ? <p className="muted">Project: {props.project.name}</p> : null}
      <div className="grid">
        {props.entries.map((entry) => (
          <article key={entry.key} className="card timeline-entry">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{entry.key}</strong>
              <span className="status-badge">memory</span>
            </div>
            <pre>{JSON.stringify(entry.value, null, 2)}</pre>
          </article>
        ))}
        {props.entries.length === 0 && !props.isLoading && !props.hasError ? (
          <p className="muted">No project memory recorded yet.</p>
        ) : null}
      </div>
      <label htmlFor="project-memory-key">Memory key</label>
      <input id="project-memory-key" className="input" value={props.memoryKey} onChange={(event) => props.onMemoryKeyChange(event.target.value)} />
      <label htmlFor="project-memory-value">Memory value (JSON)</label>
      <textarea id="project-memory-value" className="input" rows={6} value={props.memoryValue} onChange={(event) => props.onMemoryValueChange(event.target.value)} />
      {props.memoryError ? <p style={{ color: '#dc2626' }}>{props.memoryError}</p> : null}
      {props.memoryMessage ? <p style={{ color: '#16a34a' }}>{props.memoryMessage}</p> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="button" onClick={props.onSave}>Save Memory Entry</button>
      </div>
    </div>
  );
}
