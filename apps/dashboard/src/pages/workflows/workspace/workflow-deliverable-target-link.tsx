import { useState } from 'react';

import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { resolveDeliverableTargetAction } from './workflow-deliverables.support.js';

export function WorkflowDeliverableTargetLink(props: {
  target: DashboardWorkflowDeliverableTarget;
  primary?: boolean;
}): JSX.Element {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const action = resolveDeliverableTargetAction(props.target);
  const targetLabel = props.primary
    ? props.target.label
    : `${props.target.label} (${humanizeToken(props.target.target_kind)})`;
  const renderInlineReference = shouldRenderInlineReference(props.target);
  const openInNewTabLabel = buildOpenInNewTabLabel(props.target.target_kind);

  return (
    <div className="grid gap-2">
      {renderInlineReference ? (
        <>
          <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          <p className="text-xs text-muted-foreground">Already visible in this workflow workspace.</p>
        </>
      ) : action.action_kind === 'dialog_preview' ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setIsPreviewOpen(true)}>
              Preview inline
            </Button>
            <a
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              href={action.href}
              target="_blank"
              rel="noreferrer"
            >
              {openInNewTabLabel}
            </a>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          <a
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            href={action.href}
            target="_blank"
            rel="noreferrer"
          >
            {openInNewTabLabel}
          </a>
        </div>
      )}
      {props.target.path || props.target.repo_ref ? (
        <p className="text-xs text-muted-foreground">{props.target.path ?? props.target.repo_ref}</p>
      ) : null}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-h-[88vh] max-w-6xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-6 py-5 pr-14">
            <DialogTitle>{targetLabel}</DialogTitle>
            <DialogDescription>
              Review the preview inline or open the source in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="h-[72vh] min-h-[420px] bg-background">
            <iframe
              className="h-full w-full border-0"
              loading="lazy"
              src={action.href}
              title={`${targetLabel} preview`}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildOpenInNewTabLabel(targetKind: DashboardWorkflowDeliverableTarget['target_kind']): string {
  if (targetKind === 'artifact') {
    return 'Open artifact in new tab';
  }
  if (targetKind === 'input_packet_file' || targetKind === 'intervention_file') {
    return 'Open file in new tab';
  }
  return `Open ${humanizeToken(targetKind).toLowerCase()} in new tab`;
}

function shouldRenderInlineReference(target: DashboardWorkflowDeliverableTarget): boolean {
  if (target.url.trim().length === 0) {
    return true;
  }
  return target.target_kind === 'workflow'
    || target.target_kind === 'work_item'
    || target.target_kind === 'task';
}
