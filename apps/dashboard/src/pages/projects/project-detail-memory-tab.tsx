import { useState, type ComponentType, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, ChevronDown, Layers3, Sparkles } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SelectItem } from '../../components/ui/select.js';
import { MemoryEditor } from './project-memory-table.fields.js';
import { ProjectMemoryTable } from './project-memory-table.js';
import { extractMemoryEntries, type MemoryEntry } from './project-memory-support.js';
import {
  createMemoryEditorDraft,
  inferMemoryEditorKind,
  parseMemoryEditorDraft,
  type MemoryEditorDraft,
} from './project-memory-table-support.js';

const MEMORY_COMPOSER_TYPE_OPTIONS = [
  <SelectItem value="string" key="string">
    String
  </SelectItem>,
  <SelectItem value="number" key="number">
    Number
  </SelectItem>,
  <SelectItem value="boolean" key="boolean">
    Boolean
  </SelectItem>,
  <SelectItem value="json" key="json">
    JSON
  </SelectItem>,
];

type MemorySectionKey = 'current' | 'composer';

export function ProjectDetailMemoryTab(props: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [draftKey, setDraftKey] = useState('');
  const [draft, setDraft] = useState<MemoryEditorDraft>(createMemoryEditorDraft(''));
  const [isSubmitAttempted, setIsSubmitAttempted] = useState(false);
  const [expandedSection, setExpandedSection] = useState<MemorySectionKey | null>(null);
  const projectQuery = useQuery({
    queryKey: ['project', props.projectId],
    queryFn: () => dashboardApi.getProject(props.projectId),
  });
  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(props.projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
      resetComposer();
    },
  });

  if (projectQuery.isLoading) {
    return <MemoryStatusCard title="Loading project memory…" />;
  }

  if (projectQuery.error) {
    return <MemoryStatusCard title="Failed to load project memory." tone="error" />;
  }

  const entries = extractMemoryEntries(projectQuery.data?.memory as Record<string, unknown> | undefined);
  const summary = summarizeMemoryEntries(entries);
  const keyError = getMemoryKeyError(draftKey, entries, isSubmitAttempted);
  const parsedDraft = parseMemoryEditorDraft(draft);

  function toggleSection(section: MemorySectionKey): void {
    setExpandedSection((current) => (current === section ? null : section));
  }

  function resetComposer(): void {
    setDraftKey('');
    setDraft(createMemoryEditorDraft(''));
    setIsSubmitAttempted(false);
  }

  function handleSave(): void {
    setIsSubmitAttempted(true);
    if (keyError || parsedDraft.error) {
      return;
    }
    patchMutation.mutate({ key: draftKey.trim(), value: parsedDraft.value });
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Memory at a glance</CardTitle>
          <CardDescription>
            Start with Current memory to review reusable context. Open Add memory entry only when a
            new key is needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <MemorySummaryCard
            title="Memory posture"
            value={`${summary.totalEntries} entries`}
            detail="Shared project context available to future workflow runs and operators."
            icon={BrainCircuit}
          />
          <MemorySummaryCard
            title="Structured values"
            value={`${summary.structuredEntries} typed`}
            detail="Typed JSON, booleans, and numbers stay readable and editable in place."
            icon={Layers3}
          />
          <MemorySummaryCard
            title="Plain-text notes"
            value={`${summary.stringEntries} string`}
            detail="Use these for concise operator notes and reusable human-readable guidance."
            icon={Sparkles}
          />
        </CardContent>
      </Card>

      <MemorySection
        title="Current memory"
        summary={buildMemorySectionSummary(
          summary.totalEntries,
          entries.length === 0
            ? 'No shared keys saved yet.'
            : 'Review shared notes, flags, and structured values before editing.',
        )}
        description="Review and update shared memory with responsive card or table layouts, depending on viewport size."
        isExpanded={expandedSection === 'current'}
        onToggle={() => toggleSection('current')}
      >
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-sm text-muted">
            No project memory yet.
          </p>
        ) : (
          <ProjectMemoryTable projectId={props.projectId} entries={entries} />
        )}
      </MemorySection>

      <MemorySection
        title="Add memory entry"
        summary={buildComposerSummary(draftKey)}
        description="Create a typed project-memory record with the same structured controls used elsewhere in the memory browser."
        isExpanded={expandedSection === 'composer'}
        onToggle={() => toggleSection('composer')}
      >
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Key</span>
              <Input
                placeholder="release_notes"
                value={draftKey}
                onChange={(event) => {
                  setDraftKey(event.target.value);
                  setIsSubmitAttempted(false);
                }}
              />
            </label>
            <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
              <MemoryEditor
                draft={draft}
                valueTypeLabel="Value type"
                typeOptions={MEMORY_COMPOSER_TYPE_OPTIONS}
                saveLabel="Add entry"
                onChange={(next) => setDraft(next)}
                onSave={handleSave}
                onCancel={resetComposer}
                isSaving={patchMutation.isPending}
              />
            </div>
          </div>
          {keyError ? <p className="text-sm text-red-600">{keyError}</p> : null}
          {patchMutation.isError ? (
            <p className="text-sm text-red-600">
              {patchMutation.error instanceof Error
                ? patchMutation.error.message
                : 'Failed to save project memory.'}
            </p>
          ) : null}
          <p className="text-sm leading-6 text-muted">
            Keys should be stable and reusable. Add a new key for new operator context instead of
            overwriting a different concept under an existing name.
          </p>
        </div>
      </MemorySection>
    </div>
  );
}

function MemorySummaryCard(props: {
  title: string;
  value: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted">{props.title}</CardTitle>
        <props.icon className="h-4 w-4 text-muted" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{props.value}</p>
        <p className="mt-2 text-xs leading-5 text-muted">{props.detail}</p>
      </CardContent>
    </Card>
  );
}

function MemorySection(props: {
  title: string;
  summary: string;
  description: string;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-6 py-5 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-2">
          <CardTitle className="text-base">{props.title}</CardTitle>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {props.summary}
          </p>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
        </div>
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted transition-transform', props.isExpanded && 'rotate-180')}
        />
      </button>
      {props.isExpanded ? <CardContent className="border-t border-border/70 pt-6">{props.children}</CardContent> : null}
    </Card>
  );
}

function MemoryStatusCard(props: {
  title: string;
  tone?: 'default' | 'error';
}): JSX.Element {
  return (
    <Card
      className={
        props.tone === 'error'
          ? 'border-red-200 bg-red-50 shadow-sm dark:border-red-800 dark:bg-red-950/30'
          : 'border-border/70 shadow-sm'
      }
    >
      <CardContent className="py-8 text-sm text-muted">{props.title}</CardContent>
    </Card>
  );
}

function summarizeMemoryEntries(entries: MemoryEntry[]): {
  totalEntries: number;
  structuredEntries: number;
  stringEntries: number;
} {
  let structuredEntries = 0;
  let stringEntries = 0;

  for (const entry of entries) {
    if (inferMemoryEditorKind(entry.value) === 'string') {
      stringEntries += 1;
    } else {
      structuredEntries += 1;
    }
  }

  return {
    totalEntries: entries.length,
    structuredEntries,
    stringEntries,
  };
}

function getMemoryKeyError(
  draftKey: string,
  entries: MemoryEntry[],
  isSubmitAttempted: boolean,
): string | null {
  const normalizedKey = draftKey.trim();
  if (!normalizedKey) {
    return isSubmitAttempted ? 'Enter a key before adding a memory entry.' : null;
  }
  if (entries.some((entry) => entry.key === normalizedKey)) {
    return `Choose a different key. '${normalizedKey}' already exists in project memory.`;
  }
  return null;
}

function buildMemorySectionSummary(count: number, detail: string): string {
  if (count === 0) {
    return `No entries yet • ${detail}`;
  }
  return `${count} ${count === 1 ? 'entry' : 'entries'} • ${detail}`;
}

function buildComposerSummary(draftKey: string): string {
  const normalizedKey = draftKey.trim();
  return normalizedKey
    ? `Preparing key • ${normalizedKey}`
    : 'Add typed context without opening the standalone memory browser';
}
