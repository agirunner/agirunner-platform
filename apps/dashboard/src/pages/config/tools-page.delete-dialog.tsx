import { Loader2, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { describeToolCategory, type ToolTag } from './tools-page.support.js';

export function DeleteToolDialog(props: {
  tool: ToolTag | null;
  isDeleting: boolean;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}): JSX.Element | null {
  if (!props.tool) {
    return null;
  }

  const category = describeToolCategory(props.tool.category);

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete tool?</DialogTitle>
          <DialogDescription>
            Remove this tool from the shared catalog. This action is irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{props.tool.name}</p>
              <Badge variant={category.badgeVariant}>{category.label}</Badge>
            </div>
            <p className="font-mono text-xs text-muted">{props.tool.id}</p>
            <p className="text-sm text-muted">
              {props.tool.description?.trim() || 'No description provided.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={props.onConfirm}
            disabled={props.isDeleting}
            data-testid="confirm-delete-tool"
          >
            {props.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete Tool
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
