import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Pencil,
  ShieldCheck,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

interface RoleDefinition {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  capabilities?: string[];
  model?: string;
  verification_strategy?: string;
}

interface RoleEditForm {
  name: string;
  description: string;
  system_prompt: string;
  allowed_tools: string[];
  verification_strategy: string;
}

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchRoles(): Promise<RoleDefinition[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/roles`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function updateRole(
  roleId: string,
  payload: Partial<RoleEditForm>,
): Promise<RoleDefinition> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/roles/${roleId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

const KNOWN_TOOLS = [
  'file_read',
  'file_write',
  'shell_exec',
  'web_search',
  'code_review',
  'test_runner',
  'git_operations',
  'api_request',
];

function RoleRow({ role }: { role: RoleDefinition }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <TableRow
        className={cn('cursor-pointer', isExpanded && 'border-b-0')}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <TableCell>
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
            <span className="font-medium">{role.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted">
          {role.description ?? '-'}
        </TableCell>
        <TableCell>
          <Badge variant="outline">
            {role.allowed_tools?.length ?? 0}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-xs">
          {role.model ?? 'default'}
        </TableCell>
        <TableCell>
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={5} className="bg-border/10">
            <div className="space-y-3 py-2">
              {role.system_prompt && (
                <div>
                  <p className="text-xs font-medium text-muted mb-1">
                    System Prompt Preview
                  </p>
                  <p className="text-sm bg-surface rounded p-2 font-mono whitespace-pre-wrap max-h-32 overflow-auto">
                    {role.system_prompt.length > 300
                      ? `${role.system_prompt.slice(0, 300)}...`
                      : role.system_prompt}
                  </p>
                </div>
              )}
              {role.capabilities && role.capabilities.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted mb-1">
                    Capabilities
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {role.capabilities.map((cap) => (
                      <Badge key={cap} variant="secondary">
                        {cap}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {role.allowed_tools && role.allowed_tools.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted mb-1">
                    Allowed Tools
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {role.allowed_tools.map((tool) => (
                      <Badge key={tool} variant="outline">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
      {isEditing && (
        <RoleEditDialog
          role={role}
          onClose={() => setIsEditing(false)}
        />
      )}
    </>
  );
}

function RoleEditDialog({
  role,
  onClose,
}: {
  role: RoleDefinition;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RoleEditForm>({
    name: role.name,
    description: role.description ?? '',
    system_prompt: role.system_prompt ?? '',
    allowed_tools: role.allowed_tools ?? [],
    verification_strategy: role.verification_strategy ?? 'none',
  });

  const mutation = useMutation({
    mutationFn: () => updateRole(role.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
  });

  function toggleTool(tool: string) {
    setForm((prev) => {
      const hasIt = prev.allowed_tools.includes(tool);
      return {
        ...prev,
        allowed_tools: hasIt
          ? prev.allowed_tools.filter((t) => t !== tool)
          : [...prev.allowed_tools, tool],
      };
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Role: {role.name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">System Prompt</label>
            <Textarea
              value={form.system_prompt}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, system_prompt: e.target.value }))
              }
              rows={5}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Allowed Tools</label>
            <div className="grid grid-cols-2 gap-2">
              {KNOWN_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={form.allowed_tools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                    className="rounded"
                  />
                  {tool}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Verification Strategy</label>
            <Select
              value={form.verification_strategy}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, verification_strategy: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="peer_review">Peer Review</SelectItem>
                <SelectItem value="human_approval">Human Approval</SelectItem>
                <SelectItem value="automated_test">Automated Test</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{String(mutation.error)}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RoleDefinitionsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['roles'],
    queryFn: fetchRoles,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load roles: {String(error)}
        </div>
      </div>
    );
  }

  const roles = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Role Definitions</h1>
        <p className="text-sm text-muted">
          Define agent roles, permissions, and capability sets.
        </p>
      </div>

      {roles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <ShieldCheck className="h-12 w-12 mb-4" />
          <p className="font-medium">No roles defined</p>
          <p className="text-sm mt-1">
            Roles will appear here once configured.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <RoleRow key={role.id} role={role} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
