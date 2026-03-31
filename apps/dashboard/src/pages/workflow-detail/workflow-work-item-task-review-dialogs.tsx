import { useEffect, useState } from 'react';

import type { DashboardAgentRecord } from '../../lib/api.js';
import { SearchableCombobox } from '../../components/log-viewer/ui/searchable-combobox.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  agentDisplayName,
  buildAgentItems,
  sortAgents,
} from './workflow-work-item-task-review-dialogs.support.js';

export function StepChangesDialog(props: {
  isOpen: boolean;
  state: string;
  taskTitle: string;
  feedback: string;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onFeedbackChange(value: string): void;
  onReject(): void;
  onRequestChanges(): void;
}): JSX.Element {
  const [hasAttemptedAction, setHasAttemptedAction] = useState(false);
  const feedbackError =
    hasAttemptedAction && !props.feedback.trim() ? 'Enter review feedback before continuing.' : null;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: hasAttemptedAction,
    isValid: Boolean(props.feedback.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  useEffect(() => {
    if (!props.isOpen) {
      setHasAttemptedAction(false);
    }
  }, [props.isOpen]);

  function handleAction(action: () => void): void {
    if (!props.feedback.trim()) {
      setHasAttemptedAction(true);
      return;
    }
    action();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {props.state === 'failed' ? 'Rework Step' : 'Request Step Changes'}
          </DialogTitle>
          <DialogDescription>
            Keep review feedback attached to &ldquo;{props.taskTitle}&rdquo; without expanding the
            selected work-item panel inline.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={props.feedback}
            onChange={(event) => props.onFeedbackChange(event.target.value)}
            placeholder="Describe the operator changes needed..."
            rows={4}
            aria-invalid={Boolean(feedbackError)}
          />
          {feedbackError ? <p className="text-sm text-destructive">{feedbackError}</p> : null}
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            {props.state === 'failed' ? (
              <Button onClick={() => handleAction(props.onRequestChanges)} disabled={props.isPending}>
                Rework Step
              </Button>
            ) : (
              <>
                <Button variant="destructive" onClick={() => handleAction(props.onReject)} disabled={props.isPending}>
                  Reject Step
                </Button>
                <Button onClick={() => handleAction(props.onRequestChanges)} disabled={props.isPending}>
                  Request Changes
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StepEscalationDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  instructions: string;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onInstructionsChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const instructionsError =
    hasAttemptedSubmit && !props.instructions.trim()
      ? 'Enter operator guidance before continuing.'
      : null;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(props.instructions.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  useEffect(() => {
    if (!props.isOpen) {
      setHasAttemptedSubmit(false);
    }
  }, [props.isOpen]);

  function handleSubmit(): void {
    if (!props.instructions.trim()) {
      setHasAttemptedSubmit(true);
      return;
    }
    props.onSubmit();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provide Operator Guidance</DialogTitle>
          <DialogDescription>
            Resume &ldquo;{props.taskTitle}&rdquo; from the selected work-item flow so the operator
            guidance stays attached to the right board context.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={props.instructions}
            onChange={(event) => props.onInstructionsChange(event.target.value)}
            placeholder="Describe the operator guidance needed to resume this step..."
            rows={4}
            aria-invalid={Boolean(instructionsError)}
          />
          {instructionsError ? <p className="text-sm text-destructive">{instructionsError}</p> : null}
          <p className="text-xs leading-5 text-muted">
            This keeps escalation review in a focused dialog instead of turning the task action row
            into another long inline form.
          </p>
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Close
            </Button>
            <Button onClick={handleSubmit} disabled={props.isPending}>
              Provide Operator Guidance
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StepOutputOverrideDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  description: string;
  outputDraft: string;
  reason: string;
  error: string | null;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onOutputDraftChange(value: string): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const outputDraftError =
    hasAttemptedSubmit && !props.outputDraft.trim()
      ? 'Enter replacement output JSON before continuing.'
      : null;
  const reasonError =
    hasAttemptedSubmit && !props.reason.trim() ? 'Enter a reason for the override.' : null;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: props.error,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(props.outputDraft.trim() && props.reason.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  useEffect(() => {
    if (!props.isOpen) {
      setHasAttemptedSubmit(false);
    }
  }, [props.isOpen]);

  function handleSubmit(): void {
    if (!props.outputDraft.trim() || !props.reason.trim()) {
      setHasAttemptedSubmit(true);
      return;
    }
    props.onSubmit();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Override Output</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={props.outputDraft}
            onChange={(event) => props.onOutputDraftChange(event.target.value)}
            placeholder='{"summary":"Updated output packet"}'
            rows={10}
            aria-invalid={Boolean(outputDraftError)}
          />
          {outputDraftError ? <p className="text-sm text-destructive">{outputDraftError}</p> : null}
          <Textarea
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="Explain why the stored output packet must be overridden..."
            rows={4}
            aria-invalid={Boolean(reasonError)}
          />
          {reasonError ? <p className="text-sm text-destructive">{reasonError}</p> : null}
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={props.isPending}>
              Override Output
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StepManualEscalationDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  escalationTarget: string;
  reason: string;
  isPending: boolean;
  error: string | null;
  onOpenChange(open: boolean): void;
  onEscalationTargetChange(value: string): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const escalationTargetError =
    hasAttemptedSubmit && !props.escalationTarget.trim() ? 'Enter an escalation target.' : null;
  const reasonError =
    hasAttemptedSubmit && !props.reason.trim()
      ? 'Explain why the step needs escalation.'
      : null;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: props.error,
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(props.escalationTarget.trim() && props.reason.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  useEffect(() => {
    if (!props.isOpen) {
      setHasAttemptedSubmit(false);
    }
  }, [props.isOpen]);

  function handleSubmit(): void {
    if (!props.escalationTarget.trim() || !props.reason.trim()) {
      setHasAttemptedSubmit(true);
      return;
    }
    props.onSubmit();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escalate Step</DialogTitle>
          <DialogDescription>
            Pause &ldquo;{props.taskTitle}&rdquo; and record why it needs human or cross-role help.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-medium">Escalation target</div>
            <Input
              value={props.escalationTarget}
              onChange={(event) => props.onEscalationTargetChange(event.target.value)}
              placeholder="human"
              aria-invalid={Boolean(escalationTargetError)}
            />
            <p className="text-xs leading-5 text-muted">
              Leave this as &ldquo;human&rdquo; unless a different escalation destination is already defined.
            </p>
            {escalationTargetError ? (
              <p className="text-sm text-destructive">{escalationTargetError}</p>
            ) : null}
          </div>
          <Textarea
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="Explain what is blocked and what decision or intervention is needed..."
            rows={4}
            aria-invalid={Boolean(reasonError)}
          />
          {reasonError ? <p className="text-sm text-destructive">{reasonError}</p> : null}
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={props.isPending}>
              Escalate Step
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WorkItemReassignDialog(props: {
  isOpen: boolean;
  taskTitle: string;
  agents: DashboardAgentRecord[];
  selectedAgentId: string | null;
  reason: string;
  isLoadingAgents: boolean;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onAgentChange(value: string | null): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  const agents = sortAgents(props.agents);
  const agentItems = buildAgentItems(agents);
  const selectedAgent = agents.find((agent) => agent.id === props.selectedAgentId) ?? null;
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const agentError =
    hasAttemptedSubmit && !props.selectedAgentId?.trim() ? 'Select a target agent.' : null;
  const reasonError =
    hasAttemptedSubmit && !props.reason.trim() ? 'Explain why the step should be reassigned.' : null;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: hasAttemptedSubmit,
    isValid: Boolean(props.selectedAgentId?.trim() && props.reason.trim()),
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  useEffect(() => {
    if (!props.isOpen) {
      setHasAttemptedSubmit(false);
    }
  }, [props.isOpen]);

  function handleSubmit(): void {
    if (!props.selectedAgentId?.trim() || !props.reason.trim()) {
      setHasAttemptedSubmit(true);
      return;
    }
    props.onSubmit();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reassign Step</DialogTitle>
          <DialogDescription>
            Move &ldquo;{props.taskTitle}&rdquo; to a different agent without leaving the selected
            work-item flow.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-medium">Target agent</div>
            <SearchableCombobox
              value={props.selectedAgentId}
              onChange={props.onAgentChange}
              items={agentItems}
              placeholder="Choose an agent"
              searchPlaceholder="Search agents by name, agent ID, or status"
              allGroupLabel="All agents"
              isLoading={props.isLoadingAgents}
            />
            <p className="text-xs leading-5 text-muted">
              Reassignments follow the selected agent and preserve the work-item scope.
            </p>
            {agentError ? <p className="text-sm text-destructive">{agentError}</p> : null}
          </div>
          <Textarea
            value={props.reason}
            onChange={(event) => props.onReasonChange(event.target.value)}
            placeholder="Explain why this step should move to another agent..."
            rows={4}
            aria-invalid={Boolean(reasonError)}
          />
          {reasonError ? <p className="text-sm text-destructive">{reasonError}</p> : null}
          {selectedAgent ? (
            <p className="text-xs leading-5 text-muted">
              Selected agent: {agentDisplayName(selectedAgent)}
              {selectedAgent.worker_id ? ` • agent ${selectedAgent.worker_id}` : ''}
            </p>
          ) : null}
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={props.isPending || props.isLoadingAgents}>
              Reassign Step
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
