import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { toast } from '../../lib/toast.js';
import type { DashboardRemoteMcpServerRecord } from '../../lib/api.js';
import { MetricCard } from '../role-definitions/role-definitions-list.js';
import {
  archiveRemoteMcpServer,
  createRemoteMcpServer,
  disconnectRemoteMcpOAuth,
  fetchRemoteMcpServers,
  initiateRemoteMcpOAuthAuthorization,
  reconnectRemoteMcpOAuth,
  reverifyRemoteMcpServer,
  unarchiveRemoteMcpServer,
  updateRemoteMcpServer,
} from './mcp-page.api.js';
import { McpPageDialog } from './mcp-page.dialog.js';
import {
  buildRemoteMcpCreatePayload,
  buildRemoteMcpServerStats,
  buildRemoteMcpUpdatePayload,
  createRemoteMcpServerForm,
  sortRemoteMcpServers,
  type RemoteMcpServerFormState,
} from './mcp-page.support.js';
import { McpPageTable } from './mcp-page.table.js';
import { McpPageToolsSheet } from './mcp-page.tools-sheet.js';

interface DialogState {
  mode: 'create' | 'edit';
  serverId: string | null;
}

export function McpPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogForm, setDialogForm] = useState<RemoteMcpServerFormState>(
    createRemoteMcpServerForm(),
  );
  const [toolsServer, setToolsServer] = useState<DashboardRemoteMcpServerRecord | null>(null);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success');
    const oauthError = searchParams.get('oauth_error');
    const remoteMcpServerName = searchParams.get('remote_mcp_server_name');

    if (oauthSuccess) {
      const message = remoteMcpServerName
        ? `OAuth connected successfully for ${remoteMcpServerName}.`
        : 'OAuth connected successfully.';
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] });
      setSearchParams({}, { replace: true });
    } else if (oauthError) {
      toast.error(`OAuth failed: ${oauthError}`);
      setSearchParams({}, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const serversQuery = useQuery({
    queryKey: ['remote-mcp-servers'],
    queryFn: fetchRemoteMcpServers,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!dialogState) {
        throw new Error('Open the MCP dialog before saving.');
      }
      if (dialogState.mode === 'create') {
        const payload = buildRemoteMcpCreatePayload(dialogForm);
        if (payload.authMode === 'oauth') {
          return {
            kind: 'oauth' as const,
            result: await initiateRemoteMcpOAuthAuthorization(payload),
          };
        }
        return {
          kind: 'server' as const,
          result: await createRemoteMcpServer(payload),
        };
      }
      return {
        kind: 'server' as const,
        result: await updateRemoteMcpServer(
          dialogState.serverId ?? '',
          buildRemoteMcpUpdatePayload(dialogForm),
        ),
      };
    },
    onSuccess: async (result) => {
      setDialogState(null);
      setDialogForm(createRemoteMcpServerForm());
      if (result.kind === 'oauth') {
        openAuthorizeUrl(result.result.authorizeUrl);
        toast.success('OAuth authorization started in a new window.');
        return;
      }
      await refreshRemoteMcpQueries(queryClient);
      toast.success(
        dialogState?.mode === 'edit'
          ? `Updated remote MCP server ${result.result.name}.`
          : `Created remote MCP server ${result.result.name}.`,
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save remote MCP server.');
    },
  });

  const reverifyMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      return reverifyRemoteMcpServer(server.id);
    },
    onSuccess: async (server) => {
      setBusyServerId(null);
      await refreshRemoteMcpQueries(queryClient);
      toast.success(`Reverified remote MCP server ${server.name}.`);
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to reverify remote MCP server.');
    },
  });

  const connectOauthMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      return reconnectRemoteMcpOAuth(server.id);
    },
    onSuccess: (result) => {
      setBusyServerId(null);
      openAuthorizeUrl(result.authorizeUrl);
      toast.success('OAuth authorization started in a new window.');
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to start OAuth authorization.');
    },
  });

  const disconnectOauthMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      await disconnectRemoteMcpOAuth(server.id);
      return server;
    },
    onSuccess: async (server) => {
      setBusyServerId(null);
      await refreshRemoteMcpQueries(queryClient);
      toast.success(`Disconnected OAuth for ${server.name}.`);
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect OAuth.');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      return archiveRemoteMcpServer(server.id);
    },
    onSuccess: async (server) => {
      setBusyServerId(null);
      await refreshRemoteMcpQueries(queryClient);
      toast.success(`Archived remote MCP server ${server.name}.`);
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to archive remote MCP server.');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      return unarchiveRemoteMcpServer(server.id);
    },
    onSuccess: async (server) => {
      setBusyServerId(null);
      await refreshRemoteMcpQueries(queryClient);
      toast.success(`Restored remote MCP server ${server.name}.`);
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(error instanceof Error ? error.message : 'Failed to restore remote MCP server.');
    },
  });

  const servers = useMemo(
    () => sortRemoteMcpServers(serversQuery.data ?? []),
    [serversQuery.data],
  );
  const pagination = paginateListItems(servers, page, pageSize);
  const stats = buildRemoteMcpServerStats(servers);

  if (serversQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (serversQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load remote MCP servers: {String(serversQuery.error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/integrations/mcp"
        description="Register remote MCP servers, verify connectivity, and inspect discovered tools."
        actions={
          <Button
            onClick={() => {
              setDialogState({ mode: 'create', serverId: null });
              setDialogForm(createRemoteMcpServerForm());
            }}
          >
            <Plus className="h-4 w-4" />
            Create Remote MCP Server
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Configured servers" value={stats.total} />
        <MetricCard label="Verified" value={stats.verified} tone="success" />
        <MetricCard label="OAuth connected" value={stats.oauthConnected} />
      </div>

      <DashboardSectionCard
        title="Registered servers"
        description="Manage remote MCP registrations, discovered tool snapshots, and specialist-ready connection posture."
        bodyClassName="space-y-0 p-0"
      >
        <div className="overflow-x-auto px-6 pb-0">
          <McpPageTable
            servers={pagination.items}
            busyServerId={busyServerId}
            onViewTools={setToolsServer}
            onEdit={(server) => {
              setDialogState({ mode: 'edit', serverId: server.id });
              setDialogForm(createRemoteMcpServerForm(server));
            }}
            onReverify={(server) => reverifyMutation.mutate(server)}
            onConnectOAuth={(server) => connectOauthMutation.mutate(server)}
            onDisconnectOAuth={(server) => disconnectOauthMutation.mutate(server)}
            onArchive={(server) => archiveMutation.mutate(server)}
            onRestore={(server) => restoreMutation.mutate(server)}
          />
        </div>
        <ListPagination
          page={pagination.page}
          pageSize={pageSize}
          totalItems={pagination.totalItems}
          totalPages={pagination.totalPages}
          start={pagination.start}
          end={pagination.end}
          itemLabel="servers"
          onPageChange={setPage}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
          }}
        />
      </DashboardSectionCard>

      {dialogState ? (
        <McpPageDialog
          open
          mode={dialogState.mode}
          server={servers.find((server) => server.id === dialogState.serverId) ?? null}
          form={dialogForm}
          isPending={saveMutation.isPending}
          error={saveMutation.error instanceof Error ? saveMutation.error.message : null}
          submitLabel={buildSubmitLabel(dialogState.mode, dialogForm.authMode)}
          onFormChange={setDialogForm}
          onClose={() => {
            if (!saveMutation.isPending) {
              setDialogState(null);
            }
          }}
          onSubmit={() => saveMutation.mutate()}
        />
      ) : null}

      <McpPageToolsSheet
        server={toolsServer}
        onOpenChange={(open) => {
          if (!open) {
            setToolsServer(null);
          }
        }}
      />
    </div>
  );
}

function buildSubmitLabel(mode: 'create' | 'edit', authMode: RemoteMcpServerFormState['authMode']): string {
  if (mode === 'create' && authMode === 'oauth') {
    return 'Authorize and Save';
  }
  if (mode === 'edit') {
    return 'Save Changes';
  }
  return 'Save and Verify';
}

function openAuthorizeUrl(authorizeUrl: string) {
  if (typeof window !== 'undefined') {
    window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
  }
}

async function refreshRemoteMcpQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] });
}
