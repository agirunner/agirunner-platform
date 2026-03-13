import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { readSession } from '../../lib/session.js';
import {
  CreateUserDialog,
  EditUserDialog,
} from './user-management-page.dialogs.js';
import { DeactivateDialog } from './user-management-page.deactivate-dialog.js';
import {
  PermissionDeniedState,
  UserEmptyState,
  UserManagementHeader,
  UserManagementOverview,
  UserTableSection,
} from './user-management-page.sections.js';
import type { CreateUserPayload, UpdateUserPayload, User } from './user-management-page.support.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

function normalizeUsers(response: unknown): User[] {
  if (Array.isArray(response)) {
    return response as User[];
  }
  const wrapped = response as { data?: User[] } | undefined;
  return wrapped?.data ?? [];
}

async function fetchUsers(): Promise<User[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return normalizeUsers(await response.json());
}

async function registerUser(payload: CreateUserPayload): Promise<User> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body?.data ?? body;
}

async function updateUser(userId: string, payload: UpdateUserPayload): Promise<User> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body?.data ?? body;
}

async function deleteUser(userId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export function UserManagementPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    retry: false,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading users...</div>;
  }

  const isPermissionDenied = error && String(error).includes('403');
  if (isPermissionDenied) {
    return <PermissionDeniedState />;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load users.</div>;
  }

  const users = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <UserManagementHeader onCreate={() => setIsCreateOpen(true)} />
      <UserManagementOverview users={users} />
      {users.length === 0 ? (
        <UserEmptyState onCreate={() => setIsCreateOpen(true)} />
      ) : (
        <UserTableSection
          users={users}
          onEdit={(user) => setEditTarget(user)}
          onDeactivate={(user) => setDeactivateTarget(user)}
        />
      )}
      <CreateUserDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        registerUser={registerUser}
      />
      <EditUserDialog
        isOpen={editTarget !== null}
        onClose={() => setEditTarget(null)}
        user={editTarget}
        updateUser={updateUser}
      />
      <DeactivateDialog
        isOpen={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        user={deactivateTarget}
        deleteUser={deleteUser}
      />
    </div>
  );
}
