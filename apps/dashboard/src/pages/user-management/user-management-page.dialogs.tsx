import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { toast } from '../../lib/toast.js';
import { GovernanceReviewField } from '../governance-shared/governance-review-field.js';
import {
  formatAbsoluteTimestamp,
  formatRelativeTimestamp,
} from '../governance-shared/governance-lifecycle.support.js';
import {
  describeRole,
  formatRoleLabel,
  roleVariant,
  ROLES,
  type CreateUserPayload,
  type UpdateUserPayload,
  type User,
  type UserRole,
} from './user-management-page.support.js';

export function CreateUserDialog(props: {
  isOpen: boolean;
  onClose(): void;
  registerUser(payload: CreateUserPayload): Promise<User>;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const mutation = useMutation({
    mutationFn: props.registerUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setEmail('');
      setDisplayName('');
      setRole('viewer');
      props.onClose();
      toast.success('User created');
    },
    onError: () => {
      toast.error('Failed to create user');
    },
  });

  const validationErrors = validateCreateUserDialog({
    email,
    displayName,
  });
  const canSubmit = Object.keys(validationErrors).length === 0;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!canSubmit) {
      setHasAttemptedSubmit(true);
      return;
    }

    mutation.mutate({
      email: email.trim(),
      display_name: displayName.trim(),
      role,
    });
  }

  function resetAndClose(): void {
    setEmail('');
    setDisplayName('');
    setRole('viewer');
    setHasAttemptedSubmit(false);
    props.onClose();
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            Add a platform user with the narrowest role that still fits their operational responsibilities.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="user-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@example.com"
                aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.email)}
              />
              {hasAttemptedSubmit && validationErrors.email ? (
                <p className="text-xs text-red-600 dark:text-red-400">{validationErrors.email}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label htmlFor="user-name" className="text-sm font-medium">
                Display name
              </label>
              <Input
                id="user-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Jane Doe"
                aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.displayName)}
              />
              {hasAttemptedSubmit && validationErrors.displayName ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {validationErrors.displayName}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {formatRoleLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted">{describeRole(role)}</p>
          </div>
          {mutation.isError ? (
            <p className="text-sm text-red-600">Failed to create user. Please try again.</p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={resetAndClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create user'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function validateCreateUserDialog(input: {
  email: string;
  displayName: string;
}): {
  email?: string;
  displayName?: string;
} {
  const errors: {
    email?: string;
    displayName?: string;
  } = {};

  if (!input.email.trim()) {
    errors.email = 'Enter an email address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }

  if (!input.displayName.trim()) {
    errors.displayName = 'Enter a display name.';
  }

  return errors;
}

export function EditUserDialog(props: {
  isOpen: boolean;
  onClose(): void;
  user: User | null;
  updateUser(userId: string, payload: UpdateUserPayload): Promise<User>;
}): JSX.Element {
  const queryClient = useQueryClient();
  const user = props.user;
  const [role, setRole] = useState('viewer');
  const [status, setStatus] = useState('active');

  useEffect(() => {
    if (!user) {
      return;
    }
    setRole(user.role);
    setStatus(user.status);
  }, [user]);

  const mutation = useMutation({
    mutationFn: (payload: UpdateUserPayload) => props.updateUser(user?.id ?? '', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated');
      props.onClose();
    },
    onError: () => {
      toast.error('Failed to update user');
    },
  });

  const hasChanges = Boolean(user && (role !== user.role || status !== user.status));

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!user || !hasChanges) {
      return;
    }
    mutation.mutate({ role, status });
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit user access</DialogTitle>
          <DialogDescription>
            Update access level or temporarily deactivate a person without losing audit context.
          </DialogDescription>
        </DialogHeader>
        {user ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 md:grid-cols-2">
              <GovernanceReviewField label="User" value={user.display_name} />
              <GovernanceReviewField label="Email" value={user.email} />
              <GovernanceReviewField label="Current role" value={formatRoleLabel(user.role)} badgeVariant={roleVariant(user.role)} />
              <GovernanceReviewField label="Last login" value={formatRelativeTimestamp(user.last_login)} title={formatAbsoluteTimestamp(user.last_login)} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {formatRoleLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">{describeRole(role)}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">
                  Inactive users keep audit history but lose access until re-enabled.
                </p>
              </div>
            </div>
            {mutation.isError ? (
              <p className="text-sm text-red-600">Failed to update user. Please try again.</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={props.onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!hasChanges || mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
