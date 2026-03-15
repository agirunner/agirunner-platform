export {
  PlaybookRedesignResetService,
  PLAYBOOK_REDESIGN_PRESERVED_TABLES,
  PLAYBOOK_REDESIGN_RESET_TABLES,
} from './redesign-reset-service.js';

import type { DatabasePool } from '../db/database.js';

import { PlaybookRedesignResetService } from './redesign-reset-service.js';

export async function resetPlaybookRedesignState(
  pool: DatabasePool,
  options: {
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const service = new PlaybookRedesignResetService(pool);
  await service.reset(options.env ?? process.env);
}
