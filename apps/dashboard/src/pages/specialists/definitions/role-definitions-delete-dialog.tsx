import { Loader2, Trash2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import type { RoleDefinition } from './role-definitions-page.support.js';
import { describeRoleLifecyclePolicy } from './role-definitions-lifecycle.js';

export function DeleteRoleDialog(props: {
  role: RoleDefinition | null;
  deleteErrorMessage?: string | null;
  isDeleting: boolean;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}): JSX.Element | null {
  if (!props.role) {
    return null;
  }

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete specialist?</DialogTitle>
          <DialogDescription>
            Remove this specialist definition from the workspace configuration. This action is irreversible.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{props.role.name}</p>
              <Badge variant={props.role.is_active === false ? 'warning' : 'success'}>
                {props.role.is_active === false ? 'Inactive' : 'Active'}
              </Badge>
            </div>
            <p className="text-sm text-muted">
              {props.role.description ?? 'No description provided.'}
            </p>
          </div>
          <p className="text-sm text-muted">
            {describeRoleLifecyclePolicy(props.role)}
          </p>
        </div>

        {props.deleteErrorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {props.deleteErrorMessage}
          </div>
        ) : null}

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
          >
            {props.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete Specialist
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
