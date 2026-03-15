import { createPool } from '../src/db/client.js';
import { PlaybookRedesignResetService } from '../src/services/redesign-reset-service.js';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = createPool(databaseUrl);
  try {
    const service = new PlaybookRedesignResetService(pool as never);
    await service.reset(process.env);
    console.info('[reset] Playbook redesign state reset and reseeded.');
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error('[reset] Failed to reset playbook redesign state.');
  console.error(error);
  process.exitCode = 1;
});
