import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type {
  DashboardProjectRecord,
  DashboardResolvedDocumentReference,
} from '../lib/api.js';
import { buildArtifactPermalink } from '../components/artifact-preview-support.js';
import { ChainStructuredEntryEditor } from '../components/chain-workflow-parameters.js';
import { StructuredRecordView } from '../components/structured-data.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import type { DashboardProjectMemoryEntry } from './workflow-detail-support.js';
import {
  describeDocumentReference,
  describeProjectMemoryEntry,
} from './workflow-detail-content-support.js';
import {
  readPacketNestedKeys,
  readPacketScalarFacts,
} from './workflow-detail-support.js';
import {
  describeReviewPacket,
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
  toStructuredDetailViewData,
} from './workflow-detail-presentation.js';
import {
  buildStructuredObject,
  type StructuredEntryDraft,
} from './projects/project-detail-support.js';

export function WorkflowDocumentsCard(props: {
  isLoading: boolean;
  hasError: boolean;
  documents: DashboardResolvedDocumentReference[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Documents</CardTitle>
        <CardDescription>
          Reference material available to workers in this workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SurfaceMessage tone="default" show={props.isLoading}>
          Loading documents...
        </SurfaceMessage>
        <SurfaceMessage tone="destructive" show={props.hasError}>
          Failed to load workflow documents.
        </SurfaceMessage>
        {!props.isLoading && !props.hasError ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryPanel
              label="Available references"
              value={String(props.documents.length)}
              detail="Resolved documents in operator scope."
            />
            <SummaryPanel
              label="Artifact-backed"
              value={String(props.documents.filter((document) => document.artifact).length)}
              detail="Documents backed by downloadable board artifacts."
            />
          </div>
        ) : null}
        <div className="grid gap-3">
          {props.documents.map((document) => (
            <DocumentCard key={document.logical_name} document={document} />
          ))}
          {props.documents.length === 0 && !props.isLoading && !props.hasError ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
              No workflow documents registered yet.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectMemoryCard(props: {
  project?: DashboardProjectRecord;
  entries: DashboardProjectMemoryEntry[];
  isLoading: boolean;
  hasError: boolean;
  memoryKey: string;
  memoryDrafts: StructuredEntryDraft[];
  memoryError?: string | null;
  memoryMessage?: string | null;
  onMemoryKeyChange(value: string): void;
  onMemoryDraftsChange(value: StructuredEntryDraft[]): void;
  onSave(): void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Memory</CardTitle>
        <CardDescription>
          Operator-visible shared memory for future runs and workers.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <SurfaceMessage tone="default" show={props.isLoading}>
          Loading project memory...
        </SurfaceMessage>
        <SurfaceMessage tone="destructive" show={props.hasError}>
          Failed to load project memory.
        </SurfaceMessage>
        {props.project ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryPanel
              label="Project"
              value={props.project.name}
              detail="Shared memory propagates to future board runs and operators."
            />
            <SummaryPanel
              label="Memory entries"
              value={String(props.entries.length)}
              detail="Current operator-visible keys."
            />
          </div>
        ) : null}
        <div className="grid gap-3">
          {props.entries.map((entry) => (
            <ProjectMemoryEntryCard key={entry.key} entry={entry} />
          ))}
          {props.entries.length === 0 && !props.isLoading && !props.hasError ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted">
              No project memory recorded yet.
            </div>
          ) : null}
        </div>
        <div className="grid gap-4 rounded-xl border border-border/70 bg-gradient-to-br from-border/10 via-surface to-surface p-4 shadow-sm">
          <div className="grid gap-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Memory compose
            </div>
            <div className="text-sm leading-6 text-muted">
              Add a structured project note for future runs, downstream child boards, and operator handoff.
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="project-memory-key" className="text-sm font-medium text-foreground">
              Memory key
            </label>
            <Input
              id="project-memory-key"
              value={props.memoryKey}
              onChange={(event) => props.onMemoryKeyChange(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <div className="text-sm font-medium text-foreground">Memory fields</div>
            <p className="text-xs text-muted">
              Add structured key/value memory fields instead of hand-authoring a raw JSON object.
              Use the JSON value type only when a single field needs nested object data.
            </p>
            <ChainStructuredEntryEditor
              drafts={props.memoryDrafts}
              onChange={props.onMemoryDraftsChange}
              addLabel="Add memory field"
            />
          </div>
          <MemoryDraftPreview drafts={props.memoryDrafts} />
          <SurfaceMessage tone="destructive" show={Boolean(props.memoryError)}>
            {props.memoryError}
          </SurfaceMessage>
          <SurfaceMessage tone="success" show={Boolean(props.memoryMessage)}>
            {props.memoryMessage}
          </SurfaceMessage>
          <div className="flex justify-end">
            <Button type="button" onClick={props.onSave}>
              Save Memory Entry
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectMemoryEntryCard(props: {
  entry: DashboardProjectMemoryEntry;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const packet = describeProjectMemoryEntry(props.entry.value);
  const scalarFacts = readPacketScalarFacts(props.entry.value, 4);
  const nestedKeys = readPacketNestedKeys(props.entry.value, 4);

  return (
    <Card className="border-border/70 bg-border/10 shadow-none">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">{props.entry.key}</CardTitle>
            <CardDescription>Shared operator memory entry</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Memory</Badge>
            <Badge variant="secondary">{packet.typeLabel}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-foreground">{packet.summary}</div>
            <p className="text-sm leading-6 text-muted">{packet.detail}</p>
          </div>
          {packet.badges.length > 0 ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {packet.badges.map((badge) => (
                <Badge key={badge} variant="outline">
                  {badge}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        {scalarFacts.length > 0 ? (
          <FactGrid
            title="Operator-ready facts"
            description="Quick memory signals surfaced from this key before opening the full packet."
            facts={scalarFacts}
          />
        ) : null}
        {nestedKeys.length > 0 ? (
          <div className="grid gap-2 rounded-xl border border-border/70 bg-background/80 p-4">
            <div className="text-sm font-medium text-foreground">Nested sections</div>
            <div className="flex flex-wrap gap-2">
              {nestedKeys.map((key) => (
                <Badge key={`${props.entry.key}:${key}`} variant="outline">
                  {key}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {packet.hasStructuredDetail ? (
          <div className="grid gap-3">
            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? 'Hide full memory packet' : 'Open full memory packet'}
              </Button>
            </div>
            {isExpanded ? (
              <StructuredRecordView data={props.entry.value} emptyMessage="No memory payload." />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DocumentCard(props: {
  document: DashboardResolvedDocumentReference;
}): JSX.Element {
  const { document } = props;
  const packet = describeDocumentReference(document);
  const metadataPacket = describeReviewPacket(document.metadata, 'document metadata');
  const referenceFacts = buildDocumentFacts(document);
  const metadataFacts = readPacketScalarFacts(document.metadata, 4);
  const metadataNestedKeys = readPacketNestedKeys(document.metadata, 4);
  const artifactPreviewLink = document.artifact
    ? buildArtifactPermalink(document.artifact.task_id, document.artifact.id)
    : null;

  return (
    <Card className="border-border/70 bg-border/10 shadow-none">
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">{document.title ?? document.logical_name}</CardTitle>
            <CardDescription>{packet.summary}</CardDescription>
          </div>
          <Badge variant="outline">{document.scope}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold text-foreground">{packet.summary}</div>
            <p className="text-sm leading-6 text-muted">{packet.detail}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {packet.badges.map((badge) => (
              <Badge key={badge} variant="secondary">
                {badge}
              </Badge>
            ))}
            {document.created_at ? (
              <Badge variant="outline" title={formatAbsoluteTimestamp(document.created_at)}>
                Added {formatRelativeTimestamp(document.created_at)}
              </Badge>
            ) : null}
          </div>
        </div>
        <FactGrid
          title="Reference packet facts"
          description="Source, linkage, and operator access details for this workflow document."
          facts={referenceFacts}
        />
        {packet.locationLabel ? (
          <p className="rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted">
            {packet.locationLabel}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {artifactPreviewLink ? (
            <Button asChild variant="outline" size="sm">
              <Link to={artifactPreviewLink}>Preview Artifact Packet</Link>
            </Button>
          ) : null}
          {document.task_id ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/work/tasks/${document.task_id}`}>Open Linked Step</Link>
            </Button>
          ) : null}
          {document.url ? (
            <Button asChild variant="outline" size="sm">
              <a href={document.url} target="_blank" rel="noreferrer">
                Open External Reference
              </a>
            </Button>
          ) : null}
          {document.artifact ? (
            <Button asChild variant="outline" size="sm">
              <a href={document.artifact.download_url}>
                Download Artifact-Backed Document
              </a>
            </Button>
          ) : null}
        </div>
        {packet.hasMetadata ? (
          <details className="rounded-xl border border-border/70 bg-background/80 p-4">
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Open document metadata
            </summary>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{metadataPacket.typeLabel}</Badge>
                  {metadataPacket.badges.map((badge) => (
                    <Badge key={badge} variant="outline">
                      {badge}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm leading-6 text-muted">{metadataPacket.detail}</p>
              </div>
              {metadataFacts.length > 0 ? (
                <FactGrid
                  title="Metadata facts"
                  description="Top-level metadata values surfaced for operator review."
                  facts={metadataFacts}
                />
              ) : null}
              {metadataNestedKeys.length > 0 ? (
                <div className="grid gap-2 rounded-xl border border-border/70 bg-surface/80 p-4">
                  <div className="text-sm font-medium text-foreground">Metadata sections</div>
                  <div className="flex flex-wrap gap-2">
                    {metadataNestedKeys.map((key) => (
                      <Badge key={`${document.logical_name}:${key}`} variant="outline">
                        {key}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <StructuredRecordView
                data={toStructuredDetailViewData(document.metadata)}
                emptyMessage="No document metadata."
              />
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SurfaceMessage(props: {
  tone: 'default' | 'destructive' | 'success';
  show: boolean;
  children: ReactNode;
}): JSX.Element | null {
  if (!props.show) {
    return null;
  }

  const className =
    props.tone === 'destructive'
      ? 'rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
      : props.tone === 'success'
        ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
        : 'rounded-xl border border-dashed border-border/70 bg-border/5 px-4 py-3 text-sm text-muted';

  return <p className={className}>{props.children}</p>;
}

function MemoryDraftPreview(props: { drafts: StructuredEntryDraft[] }): JSX.Element {
  const parsed = parseMemoryDrafts(props.drafts);
  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-background/70 p-4">
      <div className="text-sm font-medium">Structured preview</div>
      {parsed.error ? (
        <p className="text-sm text-red-600">{parsed.error}</p>
      ) : (
        <StructuredRecordView data={parsed.value} emptyMessage="No memory payload." />
      )}
    </div>
  );
}

function parseMemoryDrafts(
  drafts: StructuredEntryDraft[],
): { value: Record<string, unknown> | null; error: string | null } {
  try {
    return { value: buildStructuredObject(drafts, 'Project memory') ?? {}, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Memory preview contains invalid fields.',
    };
  }
}

function SummaryPanel(props: {
  label: string;
  value: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="grid gap-1 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="text-base font-semibold text-foreground">{props.value}</div>
      <div className="text-sm leading-6 text-muted">{props.detail}</div>
    </div>
  );
}

function FactGrid(props: {
  title: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-foreground">{props.title}</div>
        <p className="text-sm leading-6 text-muted">{props.description}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {props.facts.map((fact) => (
          <div
            key={`${props.title}:${fact.label}`}
            className="grid gap-1 rounded-lg border border-border/70 bg-surface px-3 py-2"
          >
            <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              {fact.label}
            </dt>
            <dd className="text-sm text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function buildDocumentFacts(
  document: DashboardResolvedDocumentReference,
): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Source', value: document.source },
    { label: 'Scope', value: document.scope },
  ];
  if (document.task_id) {
    facts.push({ label: 'Linked step', value: document.task_id });
  }
  if (document.artifact?.content_type) {
    facts.push({ label: 'Content type', value: document.artifact.content_type });
  }
  if (document.created_at) {
    facts.push({ label: 'Added', value: `Added ${formatRelativeTimestamp(document.created_at)}` });
  }
  return facts;
}
