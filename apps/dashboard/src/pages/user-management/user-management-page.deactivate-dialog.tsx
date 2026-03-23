import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { toast } from '../../lib/toast.js';
import { GovernanceReviewField } from '../governance-shared/governance-review-field.js';
import {
  formatAbsoluteTimestamp,
  formatDateLabel,
  formatRelativeTimestamp,
} from '../governance-shared/governance-lifecycle.support.js';
import { formatRoleLabel, roleVariant, type User } from './user-management-page.support.js';

export function DeactivateDialog(props: {
  isOpen: boolean;
  onClose(): void;
  user: User | null;
  deleteUser(userId: string): Promise<void>;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmationValue, setConfirmationValue] = useState('');

  const mutation = useMutation({
    mutationFn: () => props.deleteUser(props.user?.id ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deactivated');
      setConfirmationValue('');
      props.onClose();
    },
    onError: () => {
      toast.error('Failed to deactivate user');
    },
  });

  const expectedValue = props.user?.email ?? '';
  const canConfirm = confirmationValue.trim().toLowerCase() === expectedValue.toLowerCase();

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmationValue('');
          props.onClose();
        }
      }}
    >
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deactivate user access</DialogTitle>
          <DialogDescription>
            This removes platform access immediately. Type the user email to confirm the action.
          </DialogDescription>
        </DialogHeader>
        {props.user ? (
          <>
            <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 sm:grid-cols-2">
              <GovernanceReviewField label="User" value={props.user.display_name} />
              <GovernanceReviewField label="Email" value={props.user.email} />
              <GovernanceReviewField
                label="Role"
                value={formatRoleLabel(props.user.role)}
                badgeVariant={roleVariant(props.user.role)}
              />
              <GovernanceReviewField label="Status" value={props.user.status} />
              <GovernanceReviewField
                label="Last login"
                value={formatRelativeTimestamp(props.user.last_login)}
                title={formatAbsoluteTimestamp(props.user.last_login)}
              />
              <GovernanceReviewField
                label="Created"
                value={formatDateLabel(props.user.created_at)}
                title={formatAbsoluteTimestamp(props.user.created_at)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="confirm-deactivate-user" className="text-sm font-medium">
                Confirm by typing {props.user.email}
              </label>
              <Input
                id="confirm-deactivate-user"
                value={confirmationValue}
                onChange={(event) => setConfirmationValue(event.target.value)}
                placeholder={props.user.email}
              />
            </div>
          </>
        ) : null}
        {mutation.isError ? (
          <p className="text-sm text-red-600">Failed to deactivate user. Please try again.</p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={props.onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !canConfirm}
          >
            {mutation.isPending ? 'Deactivating...' : 'Deactivate access'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
