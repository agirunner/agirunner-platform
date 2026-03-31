import type { ReactNode } from 'react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { describeCountLabel } from './workflow-work-item-detail-support.js';

const metaRowClass = 'flex flex-wrap items-center gap-2';
const loadingTextClass =
  'rounded-lg border border-dashed border-border/70 bg-border/5 px-4 py-5 text-sm text-muted';
const errorTextClass = 'rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700';

export function WorkItemDetailFrame(props: {
  panelTitleId: string;
  linkedTaskCount: number;
  artifactCount: number;
  isLoading: boolean;
  hasError: boolean;
  onClearSelection(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card
      className="overflow-hidden border-accent/30 bg-surface/95 shadow-lg ring-1 ring-accent/10"
      data-testid="work-item-detail-shell"
      data-selected-panel="true"
      data-workflow-focus-anchor="true"
      tabIndex={-1}
      aria-labelledby={props.panelTitleId}
    >
      <CardHeader className="gap-3 border-b border-border/70 bg-gradient-to-br from-surface via-surface to-border/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="grid gap-3">
            <div className={metaRowClass}>
              <Badge variant="secondary">Selected work item</Badge>
              <Badge variant="outline">
                {describeCountLabel(props.linkedTaskCount, 'linked step')}
              </Badge>
              <Badge variant="outline">
                {describeCountLabel(props.artifactCount, 'artifact')}
              </Badge>
            </div>
            <div className="grid gap-2">
              <CardTitle id={props.panelTitleId} className="text-xl">
                Work Item Detail
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Start with the summary, open controls only when editing, then switch to evidence
                when you need execution detail.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={props.onClearSelection}>
            Clear Selection
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 p-4">
        {props.isLoading ? <p className={loadingTextClass}>Loading work item...</p> : null}
        {props.hasError ? (
          <p className={errorTextClass}>Failed to load work item detail.</p>
        ) : null}
        {props.children}
      </CardContent>
    </Card>
  );
}
