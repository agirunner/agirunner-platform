import { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination.js';
import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import type { DashboardRemoteMcpOAuthClientProfileRecord } from '../../lib/api.js';

export function McpPageOAuthClientProfilesSection(props: {
  profiles: DashboardRemoteMcpOAuthClientProfileRecord[];
  isLoading: boolean;
  error: string | null;
  deletingProfileId: string | null;
  onCreate(): void;
  onEdit(profile: DashboardRemoteMcpOAuthClientProfileRecord): void;
  onDelete(profile: DashboardRemoteMcpOAuthClientProfileRecord): void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const profiles = useMemo(
    () => [...props.profiles].sort((left, right) => left.name.localeCompare(right.name)),
    [props.profiles],
  );
  const pagination = paginateListItems(profiles, page, pageSize);

  return (
    <DashboardSectionCard
      title="OAuth client profiles"
      description="Manage shared host-managed OAuth client credentials and endpoint defaults for remote MCP servers."
      bodyClassName="space-y-0 p-0"
    >
      {props.isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : props.error ? (
        <div className="px-6 py-6">
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            Failed to load OAuth client profiles: {props.error}
          </div>
        </div>
      ) : profiles.length === 0 ? (
        <div className="px-6 pb-6">
          <Card className="border-border/70 bg-card/80 shadow-none">
            <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <ShieldCheck className="h-12 w-12 text-muted" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">No OAuth client profiles yet</p>
                <p className="max-w-2xl text-sm leading-6 text-muted">
                  Create a shared profile only when a remote MCP server requires host-managed OAuth
                  credentials or endpoint defaults beyond automatic discovery.
                </p>
              </div>
              <Button onClick={props.onCreate} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                Create first OAuth client profile
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto px-6 pb-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profile</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Token endpoint</TableHead>
                  <TableHead className="w-[132px] whitespace-nowrap text-center">Linked MCP servers</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagination.items.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{profile.name}</p>
                        <p className="font-mono text-xs text-muted">{profile.slug}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">{profile.client_id}</p>
                        <p className="text-sm text-muted">
                          {profile.callback_mode === 'loopback'
                            ? 'Loopback callback'
                            : 'Hosted HTTPS callback'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted">{profile.token_endpoint}</TableCell>
                    <TableCell className="text-center text-sm text-foreground">
                      {profile.linked_server_count}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <IconActionButton
                          label={`Edit ${profile.name}`}
                          onClick={() => props.onEdit(profile)}
                        >
                          <Pencil className="h-4 w-4" />
                        </IconActionButton>
                        <IconActionButton
                          label={
                            profile.linked_server_count > 0
                              ? `${profile.name} is still assigned to MCP servers`
                              : `Delete ${profile.name}`
                          }
                          disabled={profile.linked_server_count > 0 || props.deletingProfileId === profile.id}
                          onClick={() => props.onDelete(profile)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconActionButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ListPagination
            page={pagination.page}
            pageSize={pageSize}
            totalItems={pagination.totalItems}
            totalPages={pagination.totalPages}
            start={pagination.start}
            end={pagination.end}
            itemLabel="profiles"
            onPageChange={setPage}
            onPageSizeChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}
          />
        </>
      )}
    </DashboardSectionCard>
  );
}
