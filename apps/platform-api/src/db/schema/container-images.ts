import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const containerImages = pgTable('container_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  repository: text('repository').notNull(),
  tag: text('tag'),
  digest: text('digest'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
});
