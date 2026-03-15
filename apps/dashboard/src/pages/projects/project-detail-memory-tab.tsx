import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { SelectItem } from '../../components/ui/select.js';
import { MemoryEditor } from './project-memory-table.fields.js';
import { ProjectMemoryTable } from './project-memory-table.js';
import { extractMemoryEntries } from './project-memory-support.js';
import {
  createMemoryEditorDraft,
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
      <div className="space-y-1">
        <p className="text-sm leading-6 text-muted">
          Memory is for evolving notes and learned state. Keep durable policy and reference facts in
          Knowledge, and use memory for what the project learns while work is happening.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-sm text-muted">
          No project memory yet.
        </p>
      ) : (
        <ProjectMemoryTable projectId={props.projectId} entries={entries} />
      )}

      <Card className="border-border/70 shadow-none">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Add memory entry</h3>
            <p className="text-sm leading-6 text-muted">
              Add a typed memory record for new notes or learned state that should stay
              project-scoped.
            </p>
          </div>

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
                saveLabel="Add memory entry"
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
            Keys should be stable and reusable. Add a new key for new notes or learned state rather
            than overwriting a different concept under an existing name.
          </p>
        </CardContent>
      </Card>
    </div>
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

function getMemoryKeyError(
  draftKey: string,
  entries: Array<{ key: string; value: unknown }>,
  isSubmitAttempted: boolean,
): string | undefined {
  if (!isSubmitAttempted) {
    return undefined;
  }

  const normalized = draftKey.trim();
  if (!normalized) {
    return 'A key is required.';
  }

  if (entries.some((entry) => entry.key === normalized)) {
    return 'Choose a different key.';
  }

  return undefined;
}
