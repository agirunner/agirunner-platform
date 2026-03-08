import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Pencil, UserX } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

const ROLES = ['viewer', 'operator', 'agent_admin', 'workflow_admin', 'org_admin'] as const;
type UserRole = (typeof ROLES)[number];

interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  last_login?: string | null;
  created_at?: string;
}

interface CreateUserPayload {
  email: string;
  display_name: string;
  role: string;
}

interface UpdateUserPayload {
  role?: string;
  status?: string;
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.accessToken}`,
  };
}

function normalizeUsers(response: unknown): User[] {
  if (Array.isArray(response)) {
    return response as User[];
  }
  const wrapped = response as { data?: User[] } | undefined;
  return wrapped?.data ?? [];
}

async function fetchUsers(): Promise<User[]> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/users`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return normalizeUsers(await resp.json());
}

async function registerUser(payload: CreateUserPayload): Promise<User> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = await resp.json();
  return body?.data ?? body;
}

async function updateUser(userId: string, payload: UpdateUserPayload): Promise<User> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = await resp.json();
  return body?.data ?? body;
}

async function deleteUser(userId: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

const ROLE_VARIANT: Record<string, 'default' | 'destructive' | 'warning' | 'success' | 'secondary'> = {
  org_admin: 'destructive',
  workflow_admin: 'warning',
  agent_admin: 'warning',
  operator: 'default',
  viewer: 'secondary',
};

function roleVariant(role: string): 'default' | 'destructive' | 'warning' | 'success' | 'secondary' {
  return ROLE_VARIANT[role.toLowerCase()] ?? 'secondary';
}

function formatRoleLabel(role: string): string {
  return role.replace(/_/g, ' ');
}

function CreateUserDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');

  const mutation = useMutation({
    mutationFn: registerUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      resetAndClose();
      toast.success('User created');
    },
    onError: () => {
      toast.error('Failed to create user');
    },
  });

  function resetAndClose(): void {
    setEmail('');
    setDisplayName('');
    setRole('viewer');
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!email.trim() || !displayName.trim()) return;
    mutation.mutate({
      email: email.trim(),
      display_name: displayName.trim(),
      role,
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>Add a new user to the platform.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="user-email" className="text-sm font-medium">Email</label>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" required />
          </div>
          <div className="space-y-2">
            <label htmlFor="user-name" className="text-sm font-medium">Display Name</label>
            <Input id="user-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" required />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{formatRoleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to create user. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  isOpen,
  onClose,
  user,
}: {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [role, setRole] = useState(user?.role ?? 'viewer');
  const [status, setStatus] = useState(user?.status ?? 'active');

  const mutation = useMutation({
    mutationFn: (payload: UpdateUserPayload) => updateUser(user?.id ?? '', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    mutation.mutate({ role, status });
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
        if (open && user) {
          setRole(user.role);
          setStatus(user.status);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>
            Update role and status for {user?.display_name ?? user?.email ?? ''}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{formatRoleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to update user. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  isOpen,
  onClose,
  user,
}: {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
}): JSX.Element {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteUser(user?.id ?? ''),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
      toast.success('User deactivated');
    },
    onError: () => {
      toast.error('Failed to deactivate user');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate User</DialogTitle>
          <DialogDescription>
            Are you sure you want to deactivate {user?.display_name ?? user?.email ?? 'this user'}?
            This will revoke their access to the platform.
          </DialogDescription>
        </DialogHeader>
        {mutation.isError && (
          <p className="text-sm text-red-600">Failed to deactivate user. Please try again.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UserManagementPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading users...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load users.</div>;
  }

  const users = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">User Management</h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create User
        </Button>
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground">No users found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.email}</TableCell>
                <TableCell className="text-muted-foreground">{user.display_name}</TableCell>
                <TableCell>
                  <Badge variant={roleVariant(user.role)} className="capitalize">
                    {formatRoleLabel(user.role)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === 'active' ? 'success' : 'secondary'} className="capitalize">
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditTarget(user)}
                      title="Edit user"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {user.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeactivateTarget(user)}
                        title="Deactivate user"
                      >
                        <UserX className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateUserDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <EditUserDialog
        isOpen={editTarget !== null}
        onClose={() => setEditTarget(null)}
        user={editTarget}
      />
      <DeactivateDialog
        isOpen={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        user={deactivateTarget}
      />
    </div>
  );
}
