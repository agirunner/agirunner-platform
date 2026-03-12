import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save, Trash2, X } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { MemoryEntry } from './project-memory-support.js';
import {
  createMemoryEditorDraft,
  type MemoryEditorKind,
  inferMemoryEditorKind,
  isStructuredMemoryValue,
  parseMemoryEditorDraft,
  summarizeMemoryValue,
  type MemoryEditorDraft,
} from './project-memory-table-support.js';

export function ProjectMemoryTable(props: {
  entries: MemoryEntry[];
  projectId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MemoryEditorDraft | null>(null);

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(props.projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
      setEditingKey(null);
      setEditDraft(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      dashboardApi.patchProjectMemory(props.projectId, { key, value: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
    },
  });

  function startEditing(entry: MemoryEntry) {
    setEditingKey(entry.key);
    setEditDraft(createMemoryEditorDraft(entry.value));
  }

  function saveEdit(key: string) {
    if (!editDraft) {
      return;
    }
    const parsed = parseMemoryEditorDraft(editDraft);
    if (parsed.error) {
      return;
    }
    patchMutation.mutate({ key, value: parsed.value });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead className="w-[220px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.entries.map((entry) => (
          <TableRow key={entry.key}>
            <TableCell className="font-mono text-sm">{entry.key}</TableCell>
            <TableCell>
              {editingKey === entry.key ? (
                <MemoryEditor
                  draft={editDraft}
                  onChange={setEditDraft}
                  onSave={() => saveEdit(entry.key)}
                  onCancel={() => {
                    setEditingKey(null);
                    setEditDraft(null);
                  }}
                  isSaving={patchMutation.isPending}
                />
              ) : (
                <MemoryValuePreview value={entry.value} />
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{entry.scope}</Badge>
            </TableCell>
            <TableCell>
              {editingKey !== entry.key ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => startEditing(entry)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(entry.key)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MemoryEditor(props: {
  draft: MemoryEditorDraft | null;
  onChange(next: MemoryEditorDraft): void;
  onSave(): void;
  onCancel(): void;
  isSaving: boolean;
}): JSX.Element {
  const validation = props.draft ? parseMemoryEditorDraft(props.draft) : null;
  return (
    <div className="space-y-3 rounded-xl bg-border/10 p-4">
      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Value type</span>
          <Select
            value={props.draft?.kind ?? 'string'}
            onValueChange={(value) =>
              props.onChange(
                buildMemoryDraftForKind(props.draft, value as MemoryEditorKind),
              )
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">String</SelectItem>
              <SelectItem value="number">Number</SelectItem>
              <SelectItem value="boolean">Boolean</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <MemoryEditorField draft={props.draft} onChange={props.onChange} />
      </div>
      {validation?.error ? (
        <p className="text-sm text-red-600">{validation.error}</p>
      ) : (
        <p className="text-sm text-muted">
          Edit memory inline with a typed control. Known value types should stay structured.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={props.onCancel}>
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={props.onSave}
          disabled={props.isSaving || Boolean(validation?.error)}
        >
          <Save className="mr-1 h-4 w-4" />
          Save Memory
        </Button>
      </div>
    </div>
  );
}

function MemoryEditorField(props: {
  draft: MemoryEditorDraft | null;
  onChange(next: MemoryEditorDraft): void;
}): JSX.Element {
  const draft = props.draft;
  if (!draft) {
    return <div className="text-sm text-muted">No memory value selected.</div>;
  }
  if (draft.kind === 'boolean') {
    return (
      <label className="grid gap-2">
        <span className="text-sm font-medium">Value</span>
        <Select
          value={draft.booleanValue}
          onValueChange={(value) =>
            props.onChange({
              kind: 'boolean',
              textValue: draft.textValue,
              booleanValue: value as 'true' | 'false',
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      </label>
    );
  }
  if (draft.kind === 'number') {
    return (
      <label className="grid gap-2">
        <span className="text-sm font-medium">Value</span>
        <Input
          value={draft.textValue}
          onChange={(event) =>
            props.onChange({
              kind: 'number',
              textValue: event.target.value,
              booleanValue: draft.booleanValue,
            })
          }
          placeholder="Enter a numeric value"
        />
      </label>
    );
  }
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">Value</span>
      <Textarea
        value={draft.textValue}
        rows={draft.kind === 'json' ? 8 : 4}
        onChange={(event) =>
          props.onChange({
            kind: draft.kind === 'json' ? 'json' : 'string',
            textValue: event.target.value,
            booleanValue: draft.booleanValue,
          })
        }
        placeholder={
          draft.kind === 'json'
            ? 'Enter valid JSON'
            : 'Enter the memory value'
        }
      />
    </label>
  );
}

function buildMemoryDraftForKind(
  currentDraft: MemoryEditorDraft | null,
  nextKind: MemoryEditorKind,
): MemoryEditorDraft {
  if (nextKind === 'boolean') {
    return {
      kind: 'boolean',
      textValue: currentDraft?.textValue ?? '',
      booleanValue: currentDraft?.booleanValue ?? 'false',
    };
  }
  return {
    kind: nextKind,
    textValue:
      nextKind === 'string' && currentDraft?.kind !== 'string'
        ? ''
        : currentDraft?.textValue ?? '',
    booleanValue: currentDraft?.booleanValue ?? 'false',
  };
}

function MemoryValuePreview({ value }: { value: unknown }): JSX.Element {
  const kind = inferMemoryEditorKind(value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{kind}</Badge>
        <span className="text-sm text-muted">{summarizeMemoryValue(value)}</span>
      </div>
      {isStructuredMemoryValue(value) ? (
        <details className="rounded-lg bg-border/10 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Expand structured value
          </summary>
          <div className="mt-3">
            {Array.isArray(value) ? (
              <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              <StructuredRecordView data={value} emptyMessage="No structured memory payload." />
            )}
          </div>
        </details>
      ) : (
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-muted">
          {summarizeMemoryValue(value)}
        </p>
      )}
    </div>
  );
}
