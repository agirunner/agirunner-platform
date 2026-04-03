import type { DatabaseQueryable } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';
import { UserService } from '../../services/user-service.js';
import {
  isManagedRuntimeImageAlias,
  resolveSeedRuntimeImage,
} from './runtime-image-default.js';

interface WorkerDesiredStateRow {
  id: string;
  runtime_image: string | null;
}

export async function seedOrchestratorWorker(
  db: DatabaseQueryable,
  runtimeImage: string = resolveSeedRuntimeImage(process.env.RUNTIME_IMAGE),
): Promise<void> {
  const existing = await db.query(
    `SELECT id, runtime_image
       FROM worker_desired_state
      WHERE tenant_id = $1 AND pool_kind = 'orchestrator'
      LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  const existingWorker = existing.rows[0] as WorkerDesiredStateRow | undefined;
  if (existing.rowCount && existing.rowCount > 0) {
    if (!shouldNormalizeManagedRuntimeImage(existingWorker?.runtime_image)) {
      return;
    }

    await db.query(
      `UPDATE worker_desired_state
          SET runtime_image = $1
        WHERE id = $2 AND tenant_id = $3`,
      [runtimeImage, existingWorker?.id, DEFAULT_TENANT_ID],
    );
    console.info('[seed] Normalized default orchestrator worker runtime image.');
    return;
  }

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

function shouldNormalizeManagedRuntimeImage(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return true;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }

  return isManagedRuntimeImageAlias(trimmed);
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
