import type { DatabaseQueryable } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';
import { UserService } from '../../services/user-service.js';
import { resolveSeedRuntimeImage } from './runtime-image-default.js';

export async function seedOrchestratorWorker(db: DatabaseQueryable): Promise<void> {
  const existing = await db.query(
    `SELECT id FROM worker_desired_state WHERE tenant_id = $1 AND pool_kind = 'orchestrator' LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  if (existing.rowCount && existing.rowCount > 0) return;

  const runtimeImage = resolveSeedRuntimeImage(process.env.RUNTIME_IMAGE);

  await db.query(
    `INSERT INTO worker_desired_state (
        tenant_id,
        worker_name,
        role,
        runtime_image,
        cpu_limit,
        memory_limit,
        replicas,
        enabled,
        pool_kind
      )
     VALUES ($1, 'orchestrator-primary', 'orchestrator', $2, '2', '256m', 1, true, 'orchestrator')
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID, runtimeImage],
  );
  console.info('[seed] Created default orchestrator worker (orchestrator-primary, 1 replica).');
}

export async function seedAdminUser(
  db: DatabaseQueryable,
  adminEmail = 'admin@agirunner.local',
): Promise<void> {
  const userService = new UserService(db);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  await userService.createUser(DEFAULT_TENANT_ID, {
    email: adminEmail,
    displayName: 'Admin',
    role: 'org_admin',
  });

  console.info(`[seed] Admin user created: ${adminEmail}`);
}
