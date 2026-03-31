import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { DEFAULT_LIST_PAGE_SIZE, paginateListItems } from '../../lib/pagination/list-pagination.js';
import type {
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpServerRecord,
} from '../../lib/api.js';
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
import { formatMcpErrorMessage, normalizeMcpErrorText } from './mcp-page.errors.js';
import {
  handleRemoteMcpOauthStartResult,
  refreshRemoteMcpQueries,
} from './mcp-page.controller.support.js';
import {
  buildRemoteMcpOAuthClientProfileCreatePayload,
  buildRemoteMcpOAuthClientProfileUpdatePayload,
  createRemoteMcpOAuthClientProfileForm,
  type RemoteMcpOAuthClientProfileFormState,
} from './mcp-page.oauth-client-profile-form.js';
import { type RemoteMcpDeviceAuthorizationState } from './mcp-page.oauth-flow.js';
import {
  buildRemoteMcpCreatePayload,
  buildRemoteMcpServerStats,
  buildRemoteMcpUpdatePayload,
  createRemoteMcpServerForm,
  sortRemoteMcpServers,
  type RemoteMcpServerFormState,
} from './mcp-page.support.js';

export interface DialogState {
  mode: 'create' | 'edit';
  serverId: string | null;
}

export interface OAuthClientProfileDialogState {
  mode: 'create' | 'edit';
  profile: DashboardRemoteMcpOAuthClientProfileRecord | null;
}

export function useMcpPageController() {
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
  const [deviceAuthorization, setDeviceAuthorization] =
    useState<RemoteMcpDeviceAuthorizationState | null>(null);
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

  const servers = useMemo(() => sortRemoteMcpServers(serversQuery.data ?? []), [serversQuery.data]);
  const pagination = paginateListItems(servers, page, pageSize);
  const stats = buildRemoteMcpServerStats(servers);

  function openCreateServerDialog() {
    setDialogState({ mode: 'create', serverId: null });
    setDialogForm(createRemoteMcpServerForm());
  }

  function openEditServerDialog(server: DashboardRemoteMcpServerRecord) {
    setDialogState({ mode: 'edit', serverId: server.id });
    setDialogForm(createRemoteMcpServerForm(server));
  }

  function openCreateOauthClientProfileDialog() {
    setOauthClientProfileDialogState({ mode: 'create', profile: null });
    setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
  }

  function openEditOauthClientProfileDialog(profile: DashboardRemoteMcpOAuthClientProfileRecord) {
    setOauthClientProfileDialogState({ mode: 'edit', profile });
    setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm(profile));
  }

  function closeOauthClientProfileDialog() {
    setOauthClientProfileDialogState(null);
    setOauthClientProfileForm(createRemoteMcpOAuthClientProfileForm());
  }

  return {
    busyServerId,
    connectOauthMutation,
    closeOauthClientProfileDialog,
    deleteMutation,
    deleteOauthClientProfileMutation,
    deletingOauthClientProfile,
    deviceAuthorization,
    dialogForm,
    dialogState,
    disconnectOauthMutation,
    oauthClientProfileDialogState,
    oauthClientProfileForm,
    oauthClientProfilesQuery,
    openCreateOauthClientProfileDialog,
    openCreateServerDialog,
    openEditOauthClientProfileDialog,
    openEditServerDialog,
    page,
    pageSize,
    pagination,
    pollDeviceAuthorizationMutation,
    reverifyMutation,
    saveMutation,
    saveOauthClientProfileMutation,
    servers,
    serversQuery,
    setDeletingOauthClientProfile,
    setDeviceAuthorization,
    setDialogForm,
    setDialogState,
    setOauthClientProfileDialogState,
    setOauthClientProfileForm,
    setPage,
    setPageSize,
    setToolsServer,
    stats,
    toolsServer,
  };
}
