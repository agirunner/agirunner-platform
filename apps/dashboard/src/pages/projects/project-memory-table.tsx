import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Save, Trash2, X } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import type { MemoryEntry } from './project-memory-support.js';

function truncateValue(value: unknown, maxLength: number): string {
  const stringified = typeof value === 'string' ? value : JSON.stringify(value);
  if (stringified.length <= maxLength) {
    return stringified;
  }
  return `${stringified.slice(0, maxLength)}...`;
}

export function ProjectMemoryTable(props: {
  entries: MemoryEntry[];
  projectId: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const patchMutation = useMutation({
    mutationFn: (payload: { key: string; value: unknown }) =>
      dashboardApi.patchProjectMemory(props.projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', props.projectId] });
      setEditingKey(null);
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
    setEditValue(
      typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2),
    );
  }

  function saveEdit(key: string) {
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(editValue);
    } catch {
      parsedValue = editValue;
    }
    patchMutation.mutate({ key, value: parsedValue });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead className="w-[120px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.entries.map((entry) => (
          <TableRow key={entry.key}>
            <TableCell className="font-mono text-sm">{entry.key}</TableCell>
            <TableCell>
              {editingKey === entry.key ? (
                <div className="flex items-center gap-2">
                  <Input
                    className="flex-1 font-mono text-xs"
                    value={editValue}
                    onChange={(event) => setEditValue(event.target.value)}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => saveEdit(entry.key)}
                    disabled={patchMutation.isPending}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditingKey(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <span className="font-mono text-xs text-muted">{truncateValue(entry.value, 96)}</span>
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{entry.scope}</Badge>
            </TableCell>
            <TableCell>
              {editingKey !== entry.key ? (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => startEditing(entry)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(entry.key)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
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
