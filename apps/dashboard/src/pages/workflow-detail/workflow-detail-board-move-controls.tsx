import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import {
  dashboardApi,
  type DashboardWorkflowBoardColumn,
  type DashboardWorkflowStageRecord,
} from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

export function BoardMoveControls(props: {
  workflowId: string;
  workItemId: string;
  columns: DashboardWorkflowBoardColumn[];
  stages: DashboardWorkflowStageRecord[];
  initialColumnId: string;
  initialStageName: string;
  onBoardChanged?(): Promise<unknown> | unknown;
}) {
  const [columnId, setColumnId] = useState(props.initialColumnId);
  const [stageName, setStageName] = useState(props.initialStageName);
  const moveMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updateWorkflowWorkItem(props.workflowId, props.workItemId, {
        column_id: columnId,
        stage_name: stageName,
      }),
    onSuccess: async () => {
      await props.onBoardChanged?.();
    },
  });

  useEffect(() => {
    setColumnId(props.initialColumnId);
    setStageName(props.initialStageName);
  }, [props.initialColumnId, props.initialStageName]);

  const hasChanges = columnId !== props.initialColumnId || stageName !== props.initialStageName;

  return (
    <div className="grid gap-3 rounded-md border border-border/60 bg-surface/70 p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        Move work item
      </span>
      <div className="grid gap-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Column</span>
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose column" />
            </SelectTrigger>
            <SelectContent>
              {props.columns.map((column) => (
                <SelectItem key={column.id} value={column.id}>
                  {column.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">Stage</span>
          <Select value={stageName} onValueChange={setStageName}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose stage" />
            </SelectTrigger>
            <SelectContent>
              {props.stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.name}>
                  {stage.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex">
        <Button
          onClick={() => moveMutation.mutate()}
          disabled={!hasChanges || moveMutation.isPending}
        >
          {moveMutation.isPending ? 'Moving…' : 'Move item'}
        </Button>
      </div>
    </div>
  );
}
