import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card.js';
import { Badge } from '../../../components/ui/badge.js';
import { ToggleCard } from '../../../components/ui/toggle-card.js';
import type { DashboardRemoteMcpServerRecord } from '../../../lib/api.js';
import type {
  RoleDefinition,
  RoleFormState,
} from './role-definitions-page.support.js';

interface RemoteMcpOption {
  id: string;
  name: string;
  description: string;
  meta: string;
}

export function RoleRemoteMcpSection(props: {
  form: RoleFormState;
  setForm(next: RoleFormState): void;
  role?: RoleDefinition | null;
  servers: DashboardRemoteMcpServerRecord[];
}) {
  const options = buildRemoteMcpOptions(props.servers, props.role, props.form.mcpServerIds);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Remote MCP servers</CardTitle>
          <Badge variant="outline">{props.form.mcpServerIds.length}</Badge>
        </div>
        <CardDescription>
          Grant explicit remote MCP server access to this specialist. All tools from each granted server become available at execution time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {options.length === 0 ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
            No remote MCP servers are registered yet.
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {options.map((server) => {
              const checked = props.form.mcpServerIds.includes(server.id);
              return (
                <ToggleCard
                  key={server.id}
                  label={server.name}
                  description={server.description}
                  meta={server.meta}
                  checked={checked}
                  onCheckedChange={(nextChecked) => {
                    const nextIds = nextChecked
                      ? [...props.form.mcpServerIds, server.id]
                      : props.form.mcpServerIds.filter((id) => id !== server.id);
                    props.setForm({
                      ...props.form,
                      mcpServerIds: Array.from(new Set(nextIds)),
                    });
                  }}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function buildRemoteMcpOptions(
  servers: DashboardRemoteMcpServerRecord[],
  role: RoleDefinition | null | undefined,
  selectedIds: string[],
): RemoteMcpOption[] {
  const referencedById = new Map(
    (role?.mcp_servers ?? []).map((server) => [server.id, server] as const),
  );
  const serverIds = new Set<string>();

  for (const server of servers) {
    if (!server.is_archived && server.verification_status === 'verified') {
      serverIds.add(server.id);
    }
  }
  for (const id of selectedIds) {
    serverIds.add(id);
  }

  return [...serverIds]
    .map((id) => {
      const server = servers.find((entry) => entry.id === id);
      const referenced = referencedById.get(id);
      if (!server && !referenced) {
        return null;
      }
      const name = server?.name ?? referenced?.name ?? id;
      const description =
        server?.description
        ?? (referenced?.is_archived
          ? 'Archived server. Remove this grant when the specialist no longer needs it.'
          : 'Referenced server is not available for new specialist assignments.');
      const metaParts = [
        server?.endpoint_url,
        server?.verification_status === 'failed' ? 'Verification failed' : null,
        server?.is_archived || referenced?.is_archived ? 'Archived reference' : null,
      ].filter((value): value is string => Boolean(value));
      return {
        id,
        name,
        description,
        meta: metaParts.join(' | '),
      };
    })
    .filter((option): option is RemoteMcpOption => option !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
