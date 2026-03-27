import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { cn } from '../../lib/utils.js';
import type {
  RoleDialogValidation,
  RoleSetupSummary,
} from './role-definitions-dialog.support.js';

export function RoleReadinessCard(props: {
  validation: RoleDialogValidation;
  summary: RoleSetupSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Save readiness</CardTitle>
        <CardDescription>
          See blocking issues, recommendations, and live specialist posture before you save.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            'flex items-start gap-3 rounded-lg px-4 py-3 text-sm',
            props.validation.isValid
              ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              : 'border-l-4 border-red-600 bg-surface text-foreground dark:border-red-400',
          )}
        >
          {props.validation.isValid ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div>
            <p className="font-medium">
              {props.validation.isValid
                ? 'Ready to save this specialist.'
                : 'Resolve these specialist setup issues before saving.'}
            </p>
            {!props.validation.isValid ? (
              <ul className="mt-2 space-y-1">
                {props.validation.blockingIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        {props.validation.advisoryIssues.length > 0 ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
            <p className="font-medium text-foreground">Recommended before launch</p>
            <ul className="mt-2 space-y-1">
              {props.validation.advisoryIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
            : `${props.validation.blockingIssues.length} save blocker${props.validation.blockingIssues.length === 1 ? '' : 's'} remaining.`}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={props.isPending || !props.validation.isValid}>
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
