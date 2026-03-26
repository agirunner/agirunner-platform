import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { remoteMcpServers } from './remote-mcp-servers.js';

export const remoteMcpServerParameters = pgTable(
  'remote_mcp_server_parameters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    remoteMcpServerId: uuid('remote_mcp_server_id')
      .notNull()
      .references(() => remoteMcpServers.id, { onDelete: 'cascade' }),
    placement: text('placement').notNull(),
    key: text('key').notNull(),
    valueKind: text('value_kind').notNull(),
    staticValue: text('static_value'),
    encryptedSecretValue: text('encrypted_secret_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_remote_mcp_server_parameters_server').on(table.remoteMcpServerId, table.placement, table.key)],
);
