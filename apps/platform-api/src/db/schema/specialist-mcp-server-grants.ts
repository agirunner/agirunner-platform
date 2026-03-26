import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { remoteMcpServers } from './remote-mcp-servers.js';
import { roleDefinitions } from './role-definitions.js';

export const specialistMcpServerGrants = pgTable(
  'specialist_mcp_server_grants',
  {
    specialistId: uuid('specialist_id').notNull().references(() => roleDefinitions.id, { onDelete: 'cascade' }),
    remoteMcpServerId: uuid('remote_mcp_server_id').notNull().references(() => remoteMcpServers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.specialistId, table.remoteMcpServerId], name: 'pk_specialist_mcp_server_grants' }),
    index('idx_specialist_mcp_server_grants_server').on(table.remoteMcpServerId),
  ],
);
