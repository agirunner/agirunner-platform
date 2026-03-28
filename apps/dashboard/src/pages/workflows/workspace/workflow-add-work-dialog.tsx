import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import { ChainStructuredEntryEditor } from '../../../components/chain-workflow/chain-workflow-parameters.js';
import { Button } from '../../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { dashboardApi, type DashboardWorkflowBoardResponse } from '../../../lib/api.js';
import { buildFileUploadPayloads } from '../../../lib/file-upload.js';
import { toast } from '../../../lib/toast.js';
import { buildStructuredObject, type StructuredEntryDraft } from '../../playbook-launch/playbook-launch-support.js';
import { WorkflowFileInput } from '../workflow-file-input.js';
import { invalidateWorkflowsQueries } from '../workflows-query.js';

type Priority = 'critical' | 'high' | 'normal' | 'low';

export function WorkflowAddWorkDialog(props: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  workflowId: string;
  lifecycle: string | null | undefined;
  board: DashboardWorkflowBoardResponse | null;
  workItemId: string | null;
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const stageOptions = useMemo(() => {
    const ordered = props.board?.stage_summary.map((entry) => entry.name) ?? [];
    const workItemStages = props.board?.work_items.map((entry) => entry.stage_name) ?? [];
    return Array.from(new Set([...ordered, ...workItemStages])).filter((entry) => entry.length > 0);
  }, [props.board]);
  const ownerRoleOptions = useMemo(
    () =>
      Array.from(
        new Set(
          props.board?.work_items.flatMap((entry) => (entry.owner_role ? [entry.owner_role] : [])) ?? [],
        ),
      ),
    [props.board],
  );
  const selectedWorkItem = useMemo(
    () =>
      props.workItemId
        ? props.board?.work_items.find((entry) => entry.id === props.workItemId) ?? null
        : null,
    [props.board, props.workItemId],
  );

  useEffect(() => {
    if (!props.isOpen) {
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
      setHasAttemptedSubmit(false);
      return;
    }

    setTitle(selectedWorkItem?.title ?? '');
    setGoal(selectedWorkItem?.goal ?? '');
    setAcceptanceCriteria(selectedWorkItem?.acceptance_criteria ?? '');
    setStageName(selectedWorkItem?.stage_name ?? '__auto__');
    setOwnerRole(selectedWorkItem?.owner_role ?? '');
    setPriority(readPriority(selectedWorkItem?.priority));
    setNotes(selectedWorkItem?.notes ?? '');
    setFiles([]);
    setStructuredDrafts([]);
    setErrorMessage(null);
    setHasAttemptedSubmit(false);
  }, [props.isOpen, selectedWorkItem]);

  const titleError = hasAttemptedSubmit && !title.trim() ? 'Enter a work item title.' : undefined;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: errorMessage,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(title.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const structuredInputs = buildStructuredObject(structuredDrafts, 'Workflow work input');
      const workItem = selectedWorkItem
        ? await dashboardApi.updateWorkflowWorkItem(props.workflowId, selectedWorkItem.id, {
            title: title.trim() || undefined,
            goal: goal.trim() || undefined,
            acceptance_criteria: acceptanceCriteria.trim() || undefined,
            stage_name: stageName === '__auto__' ? undefined : stageName,
            owner_role: ownerRole.trim() || null,
            priority,
            notes: notes.trim() || null,
          })
        : await dashboardApi.createWorkflowWorkItem(props.workflowId, {
            title: title.trim(),
            goal: goal.trim() || undefined,
            acceptance_criteria: acceptanceCriteria.trim() || undefined,
            stage_name: stageName === '__auto__' ? undefined : stageName,
            owner_role: ownerRole.trim() || undefined,
            priority,
            notes: notes.trim() || undefined,
          });
      await dashboardApi.createWorkflowInputPacket(props.workflowId, {
        packet_kind: resolvePacketKind(props.lifecycle, selectedWorkItem?.id ?? null),
        work_item_id: workItem.id,
        summary: buildPacketSummary(props.lifecycle, selectedWorkItem?.id ?? null, workItem.title),
        structured_inputs: structuredInputs,
        files: await buildFileUploadPayloads(files),
      });
      return workItem;
    },
    onSuccess: async () => {
      await invalidateWorkflowsQueries(queryClient, props.workflowId);
      toast.success(buildSuccessMessage(props.lifecycle, selectedWorkItem?.id ?? null));
      props.onOpenChange(false);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add workflow work.');
    },
  });

  const titleLabel = selectedWorkItem
    ? 'Modify Work'
    : props.lifecycle === 'ongoing'
      ? 'Add Intake'
      : 'Add Work';
  const description = selectedWorkItem
    ? 'Update the selected work item and attach a plan-update packet without leaving the workflow workspace.'
    : props.lifecycle === 'ongoing'
      ? 'Add new incoming work, files, and typed inputs into this ongoing workflow.'
      : 'Add planned work with supporting typed inputs and immutable workflow-scoped files.';

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {titleLabel}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Validation rerun"
              aria-invalid={Boolean(titleError)}
            />
            <FieldErrorText message={titleError} />
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
              <Input list="workflow-add-work-owner-roles" value={ownerRole} onChange={(event) => setOwnerRole(event.target.value)} placeholder="Optional" />
              <datalist id="workflow-add-work-owner-roles">
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
              <Textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} className="min-h-[96px]" />
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
              <strong className="text-sm">Typed inputs</strong>
              <p className="text-sm text-muted-foreground">
                These values become a durable workflow input packet linked to the new work item.
              </p>
            </div>
            <ChainStructuredEntryEditor drafts={structuredDrafts} onChange={setStructuredDrafts} addLabel="Add structured input" />
          </div>

          <WorkflowFileInput
            files={files}
            onChange={setFiles}
            label="Input files"
            description="Attach immutable workflow-scoped files for this work item."
          />

          <FormFeedbackMessage message={formFeedbackMessage} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                if (!title.trim()) {
                  setHasAttemptedSubmit(true);
                  return;
                }
                mutation.mutate();
              }}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {titleLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolvePacketKind(lifecycle: string | null | undefined, workItemId: string | null): string {
  if (workItemId) {
    return 'plan_update';
  }
  return lifecycle === 'ongoing' ? 'intake' : 'plan_update';
}

function buildPacketSummary(
  lifecycle: string | null | undefined,
  workItemId: string | null,
  title: string,
): string {
  if (workItemId) {
    return `Plan update for ${title}`;
  }
  return lifecycle === 'ongoing' ? `Workflow intake for ${title}` : `Planned work for ${title}`;
}

function buildSuccessMessage(
  lifecycle: string | null | undefined,
  workItemId: string | null,
): string {
  if (workItemId) {
    return 'Workflow work updated';
  }
  return lifecycle === 'ongoing' ? 'Workflow intake added' : 'Workflow work added';
}

function readPriority(value: string | null | undefined): Priority {
  switch (value) {
    case 'critical':
    case 'high':
    case 'low':
      return value;
    default:
      return 'normal';
  }
}
