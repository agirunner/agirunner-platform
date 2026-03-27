import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import { ChainStructuredEntryEditor } from '../../../components/chain-workflow/chain-workflow-parameters.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi, type DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import {
  buildStructuredObject,
  type StructuredEntryDraft,
} from '../../playbook-launch/playbook-launch-support.js';
import { MissionControlFileInput } from '../mission-control-file-input.js';
import { invalidateMissionControlQueries } from '../mission-control-query.js';

type Priority = 'critical' | 'high' | 'normal' | 'low';

export function MissionControlWorkspaceAddWorkDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [stageName, setStageName] = useState('__auto__');
  const [ownerRole, setOwnerRole] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [structuredDrafts, setStructuredDrafts] = useState<StructuredEntryDraft[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stageOptions = useMemo(() => {
    const ordered = props.board?.stage_summary.map((entry) => entry.name) ?? [];
    const workItemStages = props.board?.work_items.map((entry) => entry.stage_name) ?? [];
    return Array.from(new Set([...ordered, ...workItemStages])).filter((entry) => entry.length > 0);
  }, [props.board]);

  const ownerRoleOptions = useMemo(() => {
    const roles = props.board?.work_items.flatMap((entry) => (entry.owner_role ? [entry.owner_role] : [])) ?? [];
    return Array.from(new Set(roles));
  }, [props.board]);

  useEffect(() => {
    if (props.isOpen) {
      return;
    }
    setTitle('');
    setGoal('');
    setAcceptanceCriteria('');
    setStageName('__auto__');
    setOwnerRole('');
    setPriority('normal');
    setNotes('');
    setFiles([]);
    setStructuredDrafts([]);
    setErrorMessage(null);
  }, [props.isOpen]);

  const mutation = useMutation({
    mutationFn: async () => {
      const structuredInputs = buildStructuredObject(structuredDrafts, 'Work item input');
      const workItem = await dashboardApi.createWorkflowWorkItem(props.workflowId, {
        title: title.trim(),
        goal: goal.trim() || undefined,
        acceptance_criteria: acceptanceCriteria.trim() || undefined,
        stage_name: stageName === '__auto__' ? undefined : stageName,
        owner_role: ownerRole.trim() || undefined,
        priority,
        notes: notes.trim() || undefined,
      });
      if (structuredInputs || files.length > 0) {
        await dashboardApi.createWorkflowInputPacket(props.workflowId, {
          packet_kind: 'supplemental_input',
          work_item_id: workItem.id,
          summary: `Mission Control inputs for ${workItem.title}`,
          structured_inputs: structuredInputs,
          files: await buildFileUploadPayloads(files),
        });
      }
      return workItem;
    },
    onSuccess: async () => {
      await invalidateMissionControlQueries(queryClient, props.workflowId);
      toast.success('Work item added');
      props.onOpenChange(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add work item.');
    },
  });

  const isSubmitDisabled = mutation.isPending || title.trim().length === 0;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add work item
          </DialogTitle>
          <DialogDescription>
            Add scoped work to the current workflow with optional supplemental input files and typed inputs.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Validation rerun" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Stage</span>
              <Select value={stageName} onValueChange={setStageName}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto-route stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto-route</SelectItem>
                  {stageOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Owner role</span>
              <Input
                list="mission-control-work-item-owners"
                value={ownerRole}
                onChange={(event) => setOwnerRole(event.target.value)}
                placeholder="Optional"
              />
              <datalist id="mission-control-work-item-owners">
                {ownerRoleOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Goal</span>
              <Textarea value={goal} onChange={(event) => setGoal(event.target.value)} className="min-h-[96px]" />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Acceptance criteria</span>
              <Textarea
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
                className="min-h-[96px]"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Priority</span>
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Operator note</span>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-[96px]" />
            </label>
          </div>

          <div className="grid gap-3 rounded-md border border-border p-4">
            <div className="grid gap-1">
              <strong className="text-sm">Supplemental typed inputs</strong>
              <p className="text-sm text-muted-foreground">
                These inputs are stored as a workflow-scoped input packet attached to the new work item.
              </p>
            </div>
            <ChainStructuredEntryEditor
              drafts={structuredDrafts}
              onChange={setStructuredDrafts}
              addLabel="Add structured input"
            />
          </div>

          <MissionControlFileInput
            files={files}
            onChange={setFiles}
            label="Work item files"
            description="Attach immutable workflow-scoped input files for this work item."
          />

          {errorMessage ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isSubmitDisabled} onClick={() => mutation.mutate()}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add work
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
