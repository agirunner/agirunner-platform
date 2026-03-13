import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Layers3, Plus, Sparkles } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
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

export function ProjectDetailMemoryTab(props: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [draftKey, setDraftKey] = useState('');
  const [draft, setDraft] = useState<MemoryEditorDraft>(createMemoryEditorDraft(''));
  const [isSubmitAttempted, setIsSubmitAttempted] = useState(false);
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
      <div className="grid gap-3 md:grid-cols-3">
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
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>Add memory entry</CardTitle>
          <CardDescription>
            Create a typed project-memory record with the same structured controls used elsewhere
            in the memory browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <MemoryStatusCard title="No project memory yet." />
      ) : (
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle>Current memory</CardTitle>
            <CardDescription>
              Review and update shared memory with responsive card or table layouts, depending on
              viewport size.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectMemoryTable projectId={props.projectId} entries={entries} />
          </CardContent>
        </Card>
      )}
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
