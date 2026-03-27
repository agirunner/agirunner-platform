import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plug, Plus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { toast } from '../../lib/toast.js';
import type {
  DashboardRemoteMcpAuthorizeResult,
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpServerRecord,
} from '../../lib/api.js';
import { MetricCard } from '../role-definitions/role-definitions-list.js';
import {
  createRemoteMcpOAuthClientProfile,
  createRemoteMcpServer,
  deleteRemoteMcpOAuthClientProfile,
  deleteRemoteMcpServer,
  disconnectRemoteMcpOAuth,
  fetchRemoteMcpOAuthClientProfiles,
  fetchRemoteMcpServers,
  initiateRemoteMcpOAuthAuthorization,
  pollRemoteMcpOAuthDeviceAuthorization,
  reconnectRemoteMcpOAuth,
  reverifyRemoteMcpServer,
  updateRemoteMcpOAuthClientProfile,
  updateRemoteMcpServer,
} from './mcp-page.api.js';
import { McpPageDeviceAuthorizationDialog } from './mcp-page.device-authorization-dialog.js';
import { McpPageDialog } from './mcp-page.dialog.js';
import {
  buildRemoteMcpOAuthClientProfileCreatePayload,
  buildRemoteMcpOAuthClientProfileUpdatePayload,
  createRemoteMcpOAuthClientProfileForm,
  type RemoteMcpOAuthClientProfileFormState,
} from './mcp-page.oauth-client-profile-form.js';
import { McpPageOAuthClientProfileDialog } from './mcp-page.oauth-client-profile-dialog.js';
import { McpPageOAuthClientProfilesSection } from './mcp-page.oauth-client-profiles-section.js';
import { formatMcpErrorMessage, normalizeMcpErrorText } from './mcp-page.errors.js';
import {
  resolveDeviceAuthorizationUrl,
  toDeviceAuthorizationState,
  type RemoteMcpDeviceAuthorizationState,
} from './mcp-page.oauth-flow.js';
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

interface OAuthClientProfileDialogState {
  mode: 'create' | 'edit';
  profile: DashboardRemoteMcpOAuthClientProfileRecord | null;
}

export function McpPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogState, setDialogState] = useState<DialogState | null>(null);
  const [dialogForm, setDialogForm] = useState<RemoteMcpServerFormState>(
    createRemoteMcpServerForm(),
  );
  const [oauthClientProfileDialogState, setOauthClientProfileDialogState] =
    useState<OAuthClientProfileDialogState | null>(null);
  const [oauthClientProfileForm, setOauthClientProfileForm] =
    useState<RemoteMcpOAuthClientProfileFormState>(createRemoteMcpOAuthClientProfileForm());
  const [deletingOauthClientProfile, setDeletingOauthClientProfile] =
    useState<DashboardRemoteMcpOAuthClientProfileRecord | null>(null);
  const [deviceAuthorization, setDeviceAuthorization] = useState<RemoteMcpDeviceAuthorizationState | null>(null);
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
      setDeviceAuthorization(null);
      toast.success(message);
      queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] });
      setSearchParams({}, { replace: true });
    } else if (oauthError) {
      setDeviceAuthorization(null);
      toast.error(normalizeMcpErrorText(oauthError, 'OAuth authorization failed.'));
      setSearchParams({}, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const serversQuery = useQuery({
    queryKey: ['remote-mcp-servers'],
    queryFn: fetchRemoteMcpServers,
  });
  const oauthClientProfilesQuery = useQuery({
    queryKey: ['remote-mcp-oauth-client-profiles'],
    queryFn: fetchRemoteMcpOAuthClientProfiles,
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
        await handleRemoteMcpOauthStartResult(result.result, {
          queryClient,
          setDeviceAuthorization,
        });
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
      toast.error(formatMcpErrorMessage(error, 'Failed to save remote MCP server.'));
    },
  });

  const saveOauthClientProfileMutation = useMutation({
    mutationFn: async () => {
      if (!oauthClientProfileDialogState) {
        throw new Error('Open the OAuth client profile dialog before saving.');
      }
      if (oauthClientProfileDialogState.mode === 'create') {
        return createRemoteMcpOAuthClientProfile(
          buildRemoteMcpOAuthClientProfileCreatePayload(oauthClientProfileForm),
        );
      }
      return updateRemoteMcpOAuthClientProfile(
        oauthClientProfileDialogState.profile?.id ?? '',
        buildRemoteMcpOAuthClientProfileUpdatePayload(oauthClientProfileForm),
      );
    },
    onSuccess: async (profile) => {
      await refreshRemoteMcpQueries(queryClient);
      setOauthClientProfileDialogState(null);
      setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
      toast.success(
        oauthClientProfileDialogState?.mode === 'edit'
          ? `Updated OAuth client profile ${profile.name}.`
          : `Created OAuth client profile ${profile.name}.`,
      );
    },
    onError: (error) => {
      toast.error(formatMcpErrorMessage(error, 'Failed to save OAuth client profile.'));
    },
  });

  const deleteOauthClientProfileMutation = useMutation({
    mutationFn: async () => {
      if (!deletingOauthClientProfile) {
        throw new Error('Choose an OAuth client profile to delete.');
      }
      await deleteRemoteMcpOAuthClientProfile(deletingOauthClientProfile.id);
    },
    onSuccess: async () => {
      const deletedProfileName = deletingOauthClientProfile?.name ?? 'OAuth client profile';
      await refreshRemoteMcpQueries(queryClient);
      setDeletingOauthClientProfile(null);
      toast.success(`Deleted OAuth client profile ${deletedProfileName}.`);
    },
    onError: (error) => {
      toast.error(formatMcpErrorMessage(error, 'Failed to delete OAuth client profile.'));
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
      toast.error(formatMcpErrorMessage(error, 'Failed to reverify remote MCP server.'));
    },
  });

  const connectOauthMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      return reconnectRemoteMcpOAuth(server.id);
    },
    onSuccess: async (result) => {
      setBusyServerId(null);
      await handleRemoteMcpOauthStartResult(result, {
        queryClient,
        setDeviceAuthorization,
      });
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(formatMcpErrorMessage(error, 'Failed to start OAuth authorization.'));
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
      toast.error(formatMcpErrorMessage(error, 'Failed to disconnect OAuth.'));
    },
  });

  const pollDeviceAuthorizationMutation = useMutation({
    mutationFn: async (state: RemoteMcpDeviceAuthorizationState) =>
      pollRemoteMcpOAuthDeviceAuthorization(state.deviceFlowId),
    onSuccess: async (result) => {
      await handleRemoteMcpOauthStartResult(result, {
        queryClient,
        setDeviceAuthorization,
      });
    },
    onError: (error) => {
      toast.error(formatMcpErrorMessage(error, 'Failed to check device authorization status.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (server: DashboardRemoteMcpServerRecord) => {
      setBusyServerId(server.id);
      await deleteRemoteMcpServer(server.id);
      return server;
    },
    onSuccess: async (server) => {
      setBusyServerId(null);
      await refreshRemoteMcpQueries(queryClient);
      toast.success(`Deleted remote MCP server ${server.name}.`);
    },
    onError: (error) => {
      setBusyServerId(null);
      toast.error(formatMcpErrorMessage(error, 'Failed to delete remote MCP server.'));
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
          Failed to load remote MCP servers: {formatMcpErrorMessage(serversQuery.error, 'Unable to load remote MCP servers.')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/integrations/mcp-servers"
        description="Register remote MCP servers, verify connectivity, and inspect discovered tools."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOauthClientProfileDialogState({ mode: 'create', profile: null });
                setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
              }}
            >
              <Plus className="h-4 w-4" />
              Create OAuth Client Profile
            </Button>
            <Button
              onClick={() => {
                setDialogState({ mode: 'create', serverId: null });
                setDialogForm(createRemoteMcpServerForm());
              }}
            >
              <Plus className="h-4 w-4" />
              Create Remote MCP Server
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Configured servers" value={stats.total} />
        <MetricCard label="OAuth connected" value={stats.oauthConnected} />
      </div>

      <DashboardSectionCard
        title="Registered servers"
        description="Manage remote MCP registrations, discovered tool snapshots, and specialist-ready connection posture."
        bodyClassName="space-y-0 p-0"
      >
        {servers.length === 0 ? (
          <div className="px-6 pb-6">
            <Card className="border-border/70 bg-card/80 shadow-none">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                <Plug className="h-12 w-12 text-muted" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No remote MCP servers yet</p>
                  <p className="max-w-2xl text-sm leading-6 text-muted">
                    Create the first remote MCP server, then verify connectivity, inspect
                    discovered tools, and make it available to specialists from one place.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setDialogState({ mode: 'create', serverId: null });
                    setDialogForm(createRemoteMcpServerForm());
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus className="h-4 w-4" />
                  Create first remote MCP server
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
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
                onDelete={(server) => deleteMutation.mutate(server)}
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
          </>
        )}
      </DashboardSectionCard>

      <McpPageOAuthClientProfilesSection
        profiles={oauthClientProfilesQuery.data ?? []}
        isLoading={oauthClientProfilesQuery.isLoading}
        error={
          oauthClientProfilesQuery.error
            ? formatMcpErrorMessage(
              oauthClientProfilesQuery.error,
              'Unable to load OAuth client profiles.',
            )
            : null
        }
        deletingProfileId={deletingOauthClientProfile?.id ?? null}
        onCreate={() => {
          setOauthClientProfileDialogState({ mode: 'create', profile: null });
          setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
        }}
        onEdit={(profile) => {
          setOauthClientProfileDialogState({ mode: 'edit', profile });
          setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm(profile));
        }}
        onDelete={setDeletingOauthClientProfile}
      />

      {dialogState ? (
        <McpPageDialog
          key={`${dialogState.mode}:${dialogState.serverId ?? 'create'}`}
          open
          mode={dialogState.mode}
          server={servers.find((server) => server.id === dialogState.serverId) ?? null}
          form={dialogForm}
          oauthClientProfiles={oauthClientProfilesQuery.data ?? []}
          isPending={saveMutation.isPending}
          error={
            saveMutation.error
              ? formatMcpErrorMessage(saveMutation.error, 'Failed to save remote MCP server.')
              : null
          }
          submitLabel={buildSubmitLabel(dialogState.mode, dialogForm.authMode, dialogForm.oauth.grantType)}
          onFormChange={setDialogForm}
          onClose={() => {
            if (!saveMutation.isPending) {
              setDialogState(null);
            }
          }}
          onSubmit={() => saveMutation.mutate()}
        />
      ) : null}

      <McpPageOAuthClientProfileDialog
        open={oauthClientProfileDialogState !== null}
        mode={oauthClientProfileDialogState?.mode ?? 'create'}
        form={oauthClientProfileForm}
        isPending={saveOauthClientProfileMutation.isPending}
        error={
          saveOauthClientProfileMutation.error
            ? formatMcpErrorMessage(
              saveOauthClientProfileMutation.error,
              'Failed to save OAuth client profile.',
            )
            : null
        }
        onOpenChange={(open) => {
          if (!open) {
            setOauthClientProfileDialogState(null);
            setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
          }
        }}
        onFormChange={setOauthClientProfileForm}
        onSubmit={() => saveOauthClientProfileMutation.mutate()}
      />

      <McpPageToolsSheet
        server={toolsServer}
        onOpenChange={(open) => {
          if (!open) {
            setToolsServer(null);
          }
        }}
      />

      <McpPageDeviceAuthorizationDialog
        open={deviceAuthorization !== null}
        state={deviceAuthorization}
        isPolling={pollDeviceAuthorizationMutation.isPending}
        error={
          pollDeviceAuthorizationMutation.error
            ? formatMcpErrorMessage(
              pollDeviceAuthorizationMutation.error,
              'Failed to check device authorization status.',
            )
            : null
        }
        onOpenVerificationPage={() => {
          if (deviceAuthorization) {
            openAuthorizeUrl(resolveDeviceAuthorizationUrl(deviceAuthorization));
          }
        }}
        onCheckStatus={() => {
          if (deviceAuthorization) {
            pollDeviceAuthorizationMutation.mutate(deviceAuthorization);
          }
        }}
        onClose={() => {
          if (!pollDeviceAuthorizationMutation.isPending) {
            setDeviceAuthorization(null);
          }
        }}
      />

      <Dialog
        open={deletingOauthClientProfile !== null}
        onOpenChange={(open) => {
          if (!open && !deleteOauthClientProfileMutation.isPending) {
            setDeletingOauthClientProfile(null);
          }
        }}
      >
        <DialogContent showCloseButton={!deleteOauthClientProfileMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Delete OAuth Client Profile</DialogTitle>
            <DialogDescription>
              Delete this shared OAuth client profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This permanently removes{' '}
              <span className="font-medium text-foreground">
                {deletingOauthClientProfile?.name}
              </span>{' '}
              from the shared OAuth client profile library.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteOauthClientProfileMutation.isPending}
                onClick={() => setDeletingOauthClientProfile(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={deleteOauthClientProfileMutation.isPending}
                onClick={() => deleteOauthClientProfileMutation.mutate()}
              >
                Delete Profile
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildSubmitLabel(
  mode: 'create' | 'edit',
  authMode: RemoteMcpServerFormState['authMode'],
  grantType?: RemoteMcpServerFormState['oauth']['grantType'],
): string {
  if (mode === 'create' && authMode === 'oauth') {
    if (grantType === 'device_authorization') {
      return 'Start device authorization';
    }
    if (grantType === 'client_credentials') {
      return 'Verify and Save';
    }
    return 'Authorize and Save';
  }
  if (mode === 'edit') {
    return 'Save Changes';
  }
  return 'Save and Verify';
}

function openAuthorizeUrl(authorizeUrl: string) {
  if (typeof window !== 'undefined') {
    window.location.assign(authorizeUrl);
  }
}

async function refreshRemoteMcpQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await queryClient.invalidateQueries({ queryKey: ['remote-mcp-servers'] });
  await queryClient.invalidateQueries({ queryKey: ['remote-mcp-oauth-client-profiles'] });
}

async function handleRemoteMcpOauthStartResult(
  result: DashboardRemoteMcpAuthorizeResult,
  options: {
    queryClient: ReturnType<typeof useQueryClient>;
    setDeviceAuthorization(next: RemoteMcpDeviceAuthorizationState | null): void;
  },
) {
  if (result.kind === 'browser') {
    openAuthorizeUrl(result.authorizeUrl);
    return;
  }
  if (result.kind === 'device') {
    options.setDeviceAuthorization(toDeviceAuthorizationState(result));
    toast.success('Device authorization started. Complete it in the verification page, then check the status here.');
    return;
  }
  options.setDeviceAuthorization(null);
  await refreshRemoteMcpQueries(options.queryClient);
  toast.success(`OAuth connected successfully for ${result.serverName}.`);
}
