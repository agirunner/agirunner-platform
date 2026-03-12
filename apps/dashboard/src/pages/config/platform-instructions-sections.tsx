import { History, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import type {
  DashboardPlatformInstructionRecord,
  DashboardPlatformInstructionVersionRecord,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
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
  renderPlatformInstructionSnapshot,
} from './platform-instructions-support.js';

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
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Current Baseline</CardTitle>
          <p className="text-sm text-muted">
            The active system prompt scaffold applied across the platform.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
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
            Keep task-defining behavior here, not in ad hoc runtime or role-level hidden fields.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Version History
          </CardTitle>
          <p className="text-sm text-muted">
            Compare the current draft against any saved version, then restore it as the next
            version if needed.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
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
          <DialogTitle>Clear Current Platform Instructions</DialogTitle>
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
