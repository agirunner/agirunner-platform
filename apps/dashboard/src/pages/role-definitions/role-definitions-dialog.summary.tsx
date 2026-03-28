import { Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import type {
  RoleDialogValidation,
  RoleSetupSummary,
} from './role-definitions-dialog.support.js';

export function RoleReadinessCard(props: {
  summary: RoleSetupSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup summary</CardTitle>
        <CardDescription>
          Review tools, remote MCP, skills, and environment at a glance before you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          <SummaryRow label="Tools" value={props.summary.toolSummary} />
          <SummaryRow label="Remote MCP" value={props.summary.remoteMcpSummary} />
          <SummaryRow label="Skills" value={props.summary.skillSummary} />
          <SummaryRow label="Environment" value={props.summary.environmentSummary} />
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleDialogFooter(props: {
  mutationError: unknown;
  validation: RoleDialogValidation;
  isPending: boolean;
  submitLabel: string;
  onClose(): void;
}) {
  return (
    <div className="border-t border-border/70 bg-surface/95 px-6 py-4 backdrop-blur">
      {props.mutationError ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">{String(props.mutationError)}</p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          {props.validation.isValid
            ? 'All required fields are ready. Save keeps specialist definitions and orchestration posture in sync.'
            : 'Fix the highlighted fields before saving this specialist.'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={props.isPending}>
            {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {props.submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</p>
      <p className="mt-1 text-sm text-foreground">{props.value}</p>
    </div>
  );
}
