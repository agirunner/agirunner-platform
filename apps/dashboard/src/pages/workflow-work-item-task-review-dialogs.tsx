import { Button } from '../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { Textarea } from '../components/ui/textarea.js';

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
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            {props.state === 'failed' ? (
              <Button
                onClick={props.onRequestChanges}
                disabled={!props.feedback.trim() || props.isPending}
              >
                Rework Step
              </Button>
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={props.onReject}
                  disabled={!props.feedback.trim() || props.isPending}
                >
                  Reject Step
                </Button>
                <Button
                  onClick={props.onRequestChanges}
                  disabled={!props.feedback.trim() || props.isPending}
                >
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
          />
          <p className="text-xs leading-5 text-muted">
            This keeps escalation review in a focused dialog instead of turning the task action row
            into another long inline form.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Close
            </Button>
            <Button
              onClick={props.onSubmit}
              disabled={!props.instructions.trim() || props.isPending}
            >
              Provide Operator Guidance
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
