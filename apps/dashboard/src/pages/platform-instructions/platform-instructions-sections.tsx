import { History, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import type {
  DashboardPlatformInstructionRecord,
  DashboardPlatformInstructionVersionRecord,
} from '../../lib/api.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  buildPlatformInstructionVersionLabel,
  type PlatformInstructionDraftStatus,
  type PlatformInstructionSummaryCard,
  renderPlatformInstructionSnapshot,
} from './platform-instructions-support.js';

export function PlatformInstructionSummaryCards(props: {
  cards: PlatformInstructionSummaryCard[];
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {props.cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <CardTitle className="text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PlatformInstructionOverviewCards(props: {
  currentInstruction: DashboardPlatformInstructionRecord;
  comparedVersion: DashboardPlatformInstructionVersionRecord | null;
  versions: DashboardPlatformInstructionVersionRecord[];
  selectedVersion: string;
  onSelectedVersionChange(value: string): void;
  onRestore(): void;
  isBusy: boolean;
  canRestore: boolean;
  isRestoring: boolean;
}): JSX.Element {
  const { currentInstruction } = props;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <DashboardSectionCard
        title="Current Baseline"
        description="The active system prompt scaffold applied across the platform."
        bodyClassName="space-y-3"
      >
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Version {currentInstruction.version}</Badge>
            <Badge variant="outline">
              Last saved{' '}
              {currentInstruction.updated_at
                ? new Date(currentInstruction.updated_at).toLocaleString()
                : 'never'}
            </Badge>
          </div>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted whitespace-pre-wrap">
            {renderPlatformInstructionSnapshot(currentInstruction)}
          </pre>
          <p className="text-sm text-muted">
            Keep task-defining behavior here, not in ad hoc agent or role-level hidden fields.
          </p>
      </DashboardSectionCard>

      <DashboardSectionCard
        title={
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History
          </span>
        }
        description="Compare the current draft against any saved version, then restore it as the next version if needed."
        bodyClassName="space-y-4"
      >
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Compare Against</span>
            <Select value={props.selectedVersion} onValueChange={props.onSelectedVersionChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a saved version" />
              </SelectTrigger>
              <SelectContent>
                {props.versions.map((version) => (
                  <SelectItem key={version.id} value={String(version.version)}>
                    {buildPlatformInstructionVersionLabel(version, currentInstruction.version)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted whitespace-pre-wrap">
            {renderPlatformInstructionSnapshot(props.comparedVersion)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={props.onRestore}
              disabled={!props.canRestore || props.isBusy}
            >
              {props.isRestoring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Restore Selected Version
            </Button>
            <span className="text-xs text-muted">
              Restoring writes a new version instead of mutating history in place.
            </span>
          </div>
      </DashboardSectionCard>
    </div>
  );
}

export function PlatformInstructionDraftControls(props: {
  status: PlatformInstructionDraftStatus;
  canSave: boolean;
  canClear: boolean;
  canRestore: boolean;
  selectedVersionLabel: string;
  isBusy: boolean;
  isSaving: boolean;
  isRestoring: boolean;
  onSave(): void;
  onClear(): void;
  onRestore(): void;
}): JSX.Element {
  return (
    <DashboardSectionCard
      title="Draft controls"
      description="Keep save, restore, and clear actions visible while you review long instructions."
      className="xl:sticky xl:top-6"
      bodyClassName="space-y-4"
    >
        <div
          className={
            props.status.tone === 'warning'
              ? 'rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300'
              : props.status.tone === 'ready'
                ? 'rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'
                : 'rounded-lg bg-muted/10 px-4 py-3 text-sm text-muted'
          }
        >
          <p className="font-medium text-foreground">{props.status.title}</p>
          <p className="mt-1">{props.status.detail}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Selected compare version
          </p>
          <p className="mt-1 text-sm text-foreground">{props.selectedVersionLabel}</p>
        </div>
        <div className="grid gap-2">
          <Button onClick={props.onSave} disabled={props.isBusy || !props.canSave}>
            {props.isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Save Current Draft
          </Button>
          <Button
            variant="outline"
            onClick={props.onRestore}
            disabled={props.isBusy || !props.canRestore}
          >
            {props.isRestoring ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Restore Selected Version
          </Button>
          <Button
            variant="outline"
            onClick={props.onClear}
            disabled={props.isBusy || !props.canClear}
          >
            <Trash2 className="h-4 w-4" />
            Clear Current
          </Button>
        </div>
    </DashboardSectionCard>
  );
}

export function ClearPlatformInstructionsDialog(props: {
  open: boolean;
  currentInstruction: DashboardPlatformInstructionRecord;
  isClearing: boolean;
  onOpenChange(open: boolean): void;
  onClear(): void;
}): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clear Current Instructions</DialogTitle>
          <DialogDescription>
            This writes a new empty platform-instructions version. Historical versions remain
            available for diffing and restore.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted whitespace-pre-wrap">
            {renderPlatformInstructionSnapshot(props.currentInstruction)}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={props.onClear}
              disabled={props.isClearing}
            >
              {props.isClearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Clear Instructions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
