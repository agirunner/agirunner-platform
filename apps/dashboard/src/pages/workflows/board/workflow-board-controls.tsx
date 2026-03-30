import { Pause, Play, RotateCcw, SquarePen, X } from 'lucide-react';

import { Button } from '../../../components/ui/button.js';
import { cn } from '../../../lib/utils.js';
import type {
  WorkflowBoardWorkItemAction,
  WorkflowBoardWorkItemControl,
} from './workflow-board.support.js';
import { readWorkItemControlAriaLabel } from './workflow-board.support.js';

export function BoardWorkItemControlButton(props: {
  workItemId: string;
  control: WorkflowBoardWorkItemControl;
  onAction?(input: {
    workItemId: string;
    action: WorkflowBoardWorkItemAction;
  }): void;
}): JSX.Element {
  const isDisabled = props.control.disabled || !props.onAction;
  if (props.control.action === 'needs-action') {
    return (
      <Button
        size="sm"
        type="button"
        variant={props.control.variant}
        data-work-item-local-control={props.control.action}
        data-work-item-control-ready={props.onAction ? 'true' : 'false'}
        className={cn('h-7 rounded-md px-2.5 text-xs', props.control.className)}
        disabled={isDisabled}
        onClick={(event) => {
          event.stopPropagation();
          if (isDisabled) {
            return;
          }
          props.onAction?.({
            workItemId: props.workItemId,
            action: props.control.action,
          });
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {props.control.label}
      </Button>
    );
  }

  return (
    <Button
      size="icon"
      type="button"
      variant={props.control.variant}
      data-work-item-local-control={props.control.action}
      data-work-item-control-ready={props.onAction ? 'true' : 'false'}
      aria-label={readWorkItemControlAriaLabel(props.control.action)}
      title={readWorkItemControlAriaLabel(props.control.action)}
      className={cn('h-8 w-8 rounded-md', props.control.className)}
      disabled={isDisabled}
      onClick={(event) => {
        event.stopPropagation();
        if (isDisabled) {
          return;
        }
        props.onAction?.({
          workItemId: props.workItemId,
          action: props.control.action,
        });
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {renderWorkItemControlIcon(props.control.action)}
    </Button>
  );
}

function renderWorkItemControlIcon(
  action: Exclude<WorkflowBoardWorkItemAction, 'needs-action'>,
): JSX.Element {
  switch (action) {
    case 'steer':
      return <SquarePen className="h-3.5 w-3.5" />;
    case 'pause':
      return <Pause className="h-3.5 w-3.5" />;
    case 'resume':
      return <Play className="h-3.5 w-3.5" />;
    case 'repeat':
      return <RotateCcw className="h-3.5 w-3.5" />;
    case 'cancel':
      return <X className="h-3.5 w-3.5" />;
  }
}
