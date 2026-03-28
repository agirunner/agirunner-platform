import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const agenticSettings = pgTable(
  'agentic_settings',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liveVisibilityModeDefault: text('live_visibility_mode_default').notNull().default('enhanced'),
    assembledPromptWarningThresholdChars: integer('assembled_prompt_warning_threshold_chars')
      .notNull()
      .default(32000),
    revision: integer('revision').notNull().default(0),
    updatedByOperatorId: text('updated_by_operator_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'agentic_settings_live_visibility_mode_default_check',
      sql`${table.liveVisibilityModeDefault} IN ('standard', 'enhanced')`,
    ),
    check(
      'agentic_settings_assembled_prompt_warning_threshold_chars_check',
      sql`${table.assembledPromptWarningThresholdChars} > 0`,
    ),
  ],
);
