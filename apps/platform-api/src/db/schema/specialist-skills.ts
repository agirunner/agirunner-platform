import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const specialistSkills = pgTable(
  'specialist_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary').notNull(),
    content: text('content').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_specialist_skills_tenant_slug').on(table.tenantId, table.slug),
    index('idx_specialist_skills_tenant').on(table.tenantId, table.isArchived),
  ],
);
