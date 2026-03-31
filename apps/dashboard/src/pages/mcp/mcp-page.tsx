import { Loader2, Plug, Plus } from 'lucide-react';

import { ListPagination } from '../../components/list-pagination/list-pagination.js';
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
import { MetricCard } from '../specialists/role-definitions-list.js';
import {
  buildSubmitLabel,
  resolveDeviceAuthorizationUrl,
  useMcpPageController,
} from './mcp-page.controller.js';
import { formatMcpErrorMessage } from './mcp-page.errors.js';
import { McpPageDeviceAuthorizationDialog } from './mcp-page.device-authorization-dialog.js';
import { McpPageDialog } from './mcp-page.dialog.js';
import { McpPageOAuthClientProfileDialog } from './mcp-page.oauth-client-profile-dialog.js';
import { McpPageOAuthClientProfilesSection } from './mcp-page.oauth-client-profiles-section.js';
import { McpPageTable } from './mcp-page.table.js';
import { McpPageToolsSheet } from './mcp-page.tools-sheet.js';

export function McpPage(): JSX.Element {
  const {
    busyServerId,
    closeOauthClientProfileDialog,
    connectOauthMutation,
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
  } = useMcpPageController();

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
          Failed to load remote MCP servers:{' '}
          {formatMcpErrorMessage(serversQuery.error, 'Unable to load remote MCP servers.')}
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
            <Button variant="outline" onClick={openCreateOauthClientProfileDialog}>
              <Plus className="h-4 w-4" />
              Create OAuth Client Profile
            </Button>
            <Button onClick={openCreateServerDialog}>
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
                <Button onClick={openCreateServerDialog} className="w-full sm:w-auto">
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
                onEdit={openEditServerDialog}
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
        onCreate={openCreateOauthClientProfileDialog}
        onEdit={openEditOauthClientProfileDialog}
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
          submitLabel={buildSubmitLabel(
            dialogState.mode,
            dialogForm.authMode,
            dialogForm.oauth.grantType,
          )}
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
            closeOauthClientProfileDialog();
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
            window.location.assign(resolveDeviceAuthorizationUrl(deviceAuthorization));
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
            <DialogDescription>Delete this shared OAuth client profile.</DialogDescription>
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
