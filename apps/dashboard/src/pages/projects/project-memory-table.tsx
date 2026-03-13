import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { SelectItem } from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import type { MemoryEntry } from './project-memory-support.js';
import {
  createMemoryEditorDraft,
  parseMemoryEditorDraft,
  type MemoryEditorDraft,
} from './project-memory-table-support.js';
import { MemoryEditor, MemoryValuePreview } from './project-memory-table.fields.js';

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

export function ProjectMemoryTable(props: {
  entries: MemoryEntry[];
  projectId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MemoryEditorDraft | null>(null);
  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) => dashboardApi.patchProjectMemory(props.projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
      setEditingKey(null);
      setEditDraft(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (key: string) => dashboardApi.patchProjectMemory(props.projectId, { key, value: null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
    },
  });

  const editor = createEntryEditor({ editingKey, editDraft, setEditingKey, setEditDraft, patchMutation, deleteMutation });

  return (
    <>
      <div className="grid gap-3 lg:hidden">
        {props.entries.map((entry) => (
          <MemoryEntryCard key={entry.key} entry={entry} editor={editor} />
        ))}
      </div>
      <div className="hidden overflow-x-auto lg:block">
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
                  {editor.isEditing(entry.key) ? (
                    <MemoryEditor
                      draft={editor.editDraft}
                      valueTypeLabel="Value type"
                      typeOptions={MEMORY_EDITOR_TYPE_OPTIONS}
                      saveLabel="Save Memory"
                      onChange={editor.setDraft}
                      onSave={() => editor.save(entry.key)}
                      onCancel={editor.cancel}
                      isSaving={patchMutation.isPending}
                    />
                  ) : (
                    <MemoryValuePreview
                      value={entry.value}
                      structuredDetailsLabel="Expand structured value"
                      StructuredRenderer={StructuredRecordView}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{entry.scope}</Badge>
                </TableCell>
                <TableCell>{editor.isEditing(entry.key) ? null : <MemoryEntryActions onEdit={() => editor.start(entry)} onDelete={() => editor.remove(entry.key)} isDeleting={deleteMutation.isPending} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function MemoryEntryCard(props: {
  entry: MemoryEntry;
  editor: ReturnType<typeof createEntryEditor>;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <p className="font-mono text-sm">{props.entry.key}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{props.entry.scope}</Badge>
            {props.entry.stageName ? <Badge variant="secondary">{props.entry.stageName}</Badge> : null}
          </div>
        </div>
        {props.editor.isEditing(props.entry.key) ? null : (
          <MemoryEntryActions onEdit={() => props.editor.start(props.entry)} onDelete={() => props.editor.remove(props.entry.key)} isDeleting={props.editor.isDeleting} />
        )}
      </div>
      <div className="mt-3">
        {props.editor.isEditing(props.entry.key) ? (
          <MemoryEditor
            draft={props.editor.editDraft}
            valueTypeLabel="Value type"
            typeOptions={MEMORY_EDITOR_TYPE_OPTIONS}
            saveLabel="Save Memory"
            onChange={props.editor.setDraft}
            onSave={() => props.editor.save(props.entry.key)}
            onCancel={props.editor.cancel}
            isSaving={props.editor.isSaving}
          />
        ) : (
          <MemoryValuePreview
            value={props.entry.value}
            structuredDetailsLabel="Expand structured value"
            StructuredRenderer={StructuredRecordView}
          />
        )}
      </div>
    </div>
  );
}

function MemoryEntryActions(props: {
  onEdit(): void;
  onDelete(): void;
  isDeleting: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" onClick={props.onEdit}>
        <Pencil className="mr-1 h-4 w-4" />
        Edit
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onDelete} disabled={props.isDeleting}>
        <Trash2 className="mr-1 h-4 w-4" />
        Delete
      </Button>
    </div>
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
