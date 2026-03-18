import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Trash2, X } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { MemoryEntry } from './workspace-memory-support.js';
import {
  createMemoryEditorDraft,
  inferMemoryEditorKind,
  parseMemoryEditorDraft,
  type MemoryEditorDraft,
} from './workspace-memory-table-support.js';
import {
  buildMemoryDraftForKind,
  MemoryEditorField,
  MemoryValuePreview,
} from './workspace-memory-table.fields.js';

const MEMORY_EDITOR_TYPE_OPTIONS = [
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

export function WorkspaceMemoryTable(props: {
  entries: MemoryEntry[];
  workspaceId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MemoryEditorDraft | null>(null);
  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) => dashboardApi.patchWorkspaceMemory(props.workspaceId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', props.workspaceId] });
      setEditingKey(null);
      setEditDraft(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (key: string) => dashboardApi.patchWorkspaceMemory(props.workspaceId, { key, value: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', props.workspaceId] });
    },
  });

  const editor = createEntryEditor({ editingKey, editDraft, setEditingKey, setEditDraft, patchMutation, deleteMutation });

  return (
    <div className="space-y-3">
      {props.entries.map((entry) => (
        <MemoryEntryRow key={entry.key} entry={entry} editor={editor} />
      ))}
    </div>
  );
}

function MemoryEntryRow(props: {
  entry: MemoryEntry;
  editor: ReturnType<typeof createEntryEditor>;
}): JSX.Element {
  const isEditing = props.editor.isEditing(props.entry.key);
  const draft = isEditing ? props.editor.editDraft : null;
  const parsedDraft = draft ? parseMemoryEditorDraft(draft) : null;
  const kind = draft?.kind ?? inferMemoryEditorKind(props.entry.value);

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:flex sm:flex-nowrap sm:items-center">
        <span className="text-xs font-medium text-muted sm:w-8 sm:shrink-0">Key</span>
        <div className="sm:min-w-0 sm:flex-1">
          <p className="font-mono text-sm text-foreground">{props.entry.key}</p>
        </div>
        <span className="text-xs font-medium text-muted sm:w-9 sm:shrink-0">Type</span>
        {isEditing ? (
          <Select
            value={kind}
            onValueChange={(value) =>
              props.editor.setDraft(buildMemoryDraftForKind(draft, value as MemoryEditorDraft['kind']))
            }
          >
            <SelectTrigger className="w-full sm:w-40 sm:shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{MEMORY_EDITOR_TYPE_OPTIONS}</SelectContent>
          </Select>
        ) : (
          <div className="flex flex-wrap gap-2 sm:w-40 sm:shrink-0">
            <Badge variant="outline">{formatMemoryKindLabel(kind)}</Badge>
          </div>
        )}
        {isEditing ? (
          <div className="flex items-center gap-2 sm:ml-auto">
            <IconActionButton
              label="Cancel memory edit"
              icon={<X className="h-4 w-4" />}
              onClick={props.editor.cancel}
              variant="outline"
            />
            <IconActionButton
              label="Save memory entry"
              icon={<Check className="h-4 w-4" />}
              onClick={() => props.editor.save(props.entry.key)}
              disabled={props.editor.isSaving || Boolean(parsedDraft?.error)}
            />
          </div>
        ) : (
          <MemoryEntryActions
            onEdit={() => props.editor.start(props.entry)}
            onDelete={() => props.editor.remove(props.entry.key)}
            isDeleting={props.editor.isDeleting}
          />
        )}
      </div>
      <div className="grid gap-3 sm:flex sm:items-start">
        <span className="pt-2 text-xs font-medium text-muted sm:w-10 sm:shrink-0">Value</span>
        <div className="sm:min-w-0 sm:flex-1">
          {isEditing ? (
            <MemoryEditorField draft={draft} showLabel={false} onChange={props.editor.setDraft} />
          ) : (
            <MemoryValuePreview
              value={props.entry.value}
              structuredDetailsLabel="Expand structured value"
              StructuredRenderer={StructuredRecordView}
            />
          )}
        </div>
      </div>
      {parsedDraft?.error ? <p className="text-sm text-red-600">{parsedDraft.error}</p> : null}
    </div>
  );
}

function MemoryEntryActions(props: {
  onEdit(): void;
  onDelete(): void;
  isDeleting: boolean;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 sm:ml-auto">
      <Button size="icon" variant="ghost" aria-label="Edit memory entry" onClick={props.onEdit}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Delete memory entry"
        onClick={props.onDelete}
        disabled={props.isDeleting}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function IconActionButton(props: {
  label: string;
  icon: JSX.Element;
  onClick(): void;
  disabled?: boolean;
  variant?: 'default' | 'outline';
}): JSX.Element {
  return (
    <Button
      size="icon"
      variant={props.variant ?? 'default'}
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.icon}
    </Button>
  );
}

function createEntryEditor(input: {
  editingKey: string | null;
  editDraft: MemoryEditorDraft | null;
  setEditingKey(value: string | null): void;
  setEditDraft(value: MemoryEditorDraft | null): void;
  patchMutation: { mutate(payload: { key: string; value: unknown }): void; isPending: boolean };
  deleteMutation: { mutate(key: string): void; isPending: boolean };
}) {
  return {
    editDraft: input.editDraft,
    isSaving: input.patchMutation.isPending,
    isDeleting: input.deleteMutation.isPending,
    isEditing: (key: string) => input.editingKey === key,
    start: (entry: MemoryEntry) => {
      input.setEditingKey(entry.key);
      input.setEditDraft(createMemoryEditorDraft(entry.value));
    },
    setDraft: (value: MemoryEditorDraft) => input.setEditDraft(value),
    cancel: () => {
      input.setEditingKey(null);
      input.setEditDraft(null);
    },
    save: (key: string) => {
      if (!input.editDraft) {
        return;
      }
      const parsed = parseMemoryEditorDraft(input.editDraft);
      if (parsed.error) {
        return;
      }
      input.patchMutation.mutate({ key, value: parsed.value });
    },
    remove: (key: string) => input.deleteMutation.mutate(key),
  };
}

function formatMemoryKindLabel(value: MemoryEditorDraft['kind']): string {
  switch (value) {
    case 'json':
      return 'JSON';
    case 'number':
      return 'Number';
    case 'boolean':
      return 'Boolean';
    default:
      return 'String';
  }
}
