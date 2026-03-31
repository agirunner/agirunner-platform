import type { AppEnv } from '../../config/schema.js';
import type { DatabaseQueryable } from '../../db/database.js';
import {
  seedAdminUser,
  seedOrchestratorWorker,
} from './bootstrap-content.js';
import { seedExecutionEnvironmentCatalogAndDefaults } from './execution-environments.js';
import { seedRuntimeDefaultsAndPrompts } from './runtime-defaults.js';

export async function seedConfigTables(
  db: DatabaseQueryable,
  config?: Pick<AppEnv, 'AGIRUNNER_ADMIN_EMAIL'>,
): Promise<void> {
  await seedRuntimeDefaultsAndPrompts(db);
  await seedExecutionEnvironmentCatalogAndDefaults(db);
  await seedOrchestratorWorker(db);
  await seedAdminUser(db, config?.AGIRUNNER_ADMIN_EMAIL);
}
