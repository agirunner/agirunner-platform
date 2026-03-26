import { index, integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { roleDefinitions } from './role-definitions.js';
import { specialistSkills } from './specialist-skills.js';

export const specialistSkillAssignments = pgTable(
  'specialist_skill_assignments',
  {
    specialistId: uuid('specialist_id').notNull().references(() => roleDefinitions.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull().references(() => specialistSkills.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.specialistId, table.skillId], name: 'pk_specialist_skill_assignments' }),
    index('idx_specialist_skill_assignments_skill').on(table.skillId),
  ],
);
