import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { workflows } from './workflows.js';
import { workflowInputPackets } from './workflow-input-packets.js';

export const workflowInputPacketFiles = pgTable(
  'workflow_input_packet_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    packetId: uuid('packet_id')
      .notNull()
      .references(() => workflowInputPackets.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    description: text('description'),
    storageBackend: text('storage_backend').notNull(),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_workflow_input_packet_files_packet').on(table.tenantId, table.packetId, table.createdAt),
    index('idx_workflow_input_packet_files_workflow').on(table.tenantId, table.workflowId),
  ],
);
