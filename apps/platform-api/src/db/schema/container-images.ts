import { sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const containerImages = pgTable(
  'container_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repository: text('repository').notNull(),
    tag: text('tag'),
    digest: text('digest'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_container_images_repo_tag').on(table.repository, table.tag),
    index('idx_container_images_digest')
      .on(table.digest)
      .where(sql`${table.digest} IS NOT NULL`),
  ],
);
