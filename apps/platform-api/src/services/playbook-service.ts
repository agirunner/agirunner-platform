import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';

export interface CreatePlaybookInput {
  name: string;
  slug?: string;
  description?: string;
  outcome: string;
  lifecycle?: 'planned' | 'ongoing';
  definition: Record<string, unknown>;
}

export interface UpdatePlaybookInput {
  name?: string;
  slug?: string;
  description?: string;
  outcome?: string;
  lifecycle?: 'planned' | 'ongoing';
  definition?: Record<string, unknown>;
}

export class PlaybookService {
  constructor(private readonly pool: DatabasePool) {}

  async createPlaybook(tenantId: string, input: CreatePlaybookInput) {
    const definition = parsePlaybookDefinition(input.definition);
    await this.assertKnownRoles(this.pool, tenantId, definition.roles);
    const slug = normalizeSlug(input.slug ?? input.name);
    const lifecycle = input.lifecycle ?? definition.lifecycle;
    const normalizedDefinition = { ...definition, lifecycle };

    try {
      const result = await this.pool.query(
        `INSERT INTO playbooks (
           tenant_id, name, slug, description, outcome, lifecycle, definition
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          input.name.trim(),
          slug,
          input.description?.trim() ?? null,
          input.outcome.trim(),
          lifecycle,
          normalizedDefinition,
        ],
      );
      return result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error, 'uq_playbooks_tenant_slug_version')) {
        throw new ConflictError('Playbook slug already exists');
      }
      throw error;
    }
  }

  async listPlaybooks(tenantId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    return repo.findAllPaginated(
      'playbooks',
      '*',
      [],
      [],
      'is_active DESC, updated_at DESC, created_at DESC',
      500,
      0,
    );
  }

  async getPlaybook(tenantId: string, playbookId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const playbook = await repo.findById('playbooks', '*', playbookId);
    if (!playbook) {
      throw new NotFoundError('Playbook not found');
    }
    return playbook;
  }

  async updatePlaybook(tenantId: string, playbookId: string, input: UpdatePlaybookInput) {
    const current = await this.getPlaybook(tenantId, playbookId);
    const merged = mergePlaybookInput(current, input);
    return this.insertPlaybookVersion(tenantId, current.version as number, merged);
  }

  async replacePlaybook(tenantId: string, playbookId: string, input: CreatePlaybookInput) {
    const current = await this.getPlaybook(tenantId, playbookId);
    return this.insertPlaybookVersion(tenantId, current.version as number, input);
  }

  async setPlaybookArchived(tenantId: string, playbookId: string, archived: boolean) {
    const current = await this.getPlaybook(tenantId, playbookId);
    const slug = String(current.slug);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await this.deactivatePlaybookFamily(tenantId, slug, client);
      if (archived) {
        await client.query('COMMIT');
        return { ...current, is_active: false };
      }
      const result = await client.query(
        `UPDATE playbooks
            SET is_active = true,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2
        RETURNING *`,
        [tenantId, playbookId],
      );
      await client.query('COMMIT');
      if (!result.rowCount) {
        throw new NotFoundError('Playbook not found');
      }
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePlaybook(tenantId: string, playbookId: string) {
    await this.getPlaybook(tenantId, playbookId);
    const usage = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total
         FROM workflows
        WHERE tenant_id = $1
          AND playbook_id = $2`,
      [tenantId, playbookId],
    );
    if (Number(usage.rows[0]?.total ?? '0') > 0) {
      throw new ConflictError('Cannot delete a playbook that is still referenced by workflows');
    }
    const result = await this.pool.query(
      `DELETE FROM playbooks
        WHERE tenant_id = $1
          AND id = $2
      RETURNING id`,
      [tenantId, playbookId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook not found');
    }
    return { id: playbookId, deleted: true as const };
  }

  private async insertPlaybookVersion(
    tenantId: string,
    currentVersion: number,
    input: CreatePlaybookInput,
  ) {
    const definition = parsePlaybookDefinition(input.definition);
    const slug = normalizeSlug(input.slug ?? input.name);
    const lifecycle = input.lifecycle ?? definition.lifecycle;
    const normalizedDefinition = { ...definition, lifecycle };
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await this.assertKnownRoles(client, tenantId, definition.roles);
      await this.deactivatePlaybookFamily(tenantId, slug, client);
      const result = await client.query(
        `INSERT INTO playbooks (
           tenant_id, name, slug, description, outcome, lifecycle, version, definition, is_active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         RETURNING *`,
        [
          tenantId,
          input.name.trim(),
          slug,
          input.description?.trim() ?? null,
          input.outcome.trim(),
          lifecycle,
          currentVersion + 1,
          normalizedDefinition,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error, 'uq_playbooks_tenant_slug_version')) {
        throw new ConflictError('Playbook slug already exists');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async deactivatePlaybookFamily(
    tenantId: string,
    slug: string,
    client: DatabaseClient,
  ) {
    await client.query(
      `UPDATE playbooks
          SET is_active = false,
              updated_at = now()
        WHERE tenant_id = $1
          AND slug = $2
          AND is_active = true`,
      [tenantId, slug],
    );
  }

  private async assertKnownRoles(
    executor: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    roles: string[],
  ): Promise<void> {
    const requested = Array.from(new Set(roles.map((role) => role.trim()).filter(Boolean)));
    if (requested.length === 0) {
      return;
    }

    const result = await executor.query<{ name: string }>(
      `SELECT name
         FROM role_definitions
        WHERE tenant_id = $1
          AND is_active = true
          AND name = ANY($2::text[])`,
      [tenantId, requested],
    );

    const known = new Set(result.rows.map((row) => row.name));
    const missing = requested.filter((role) => !known.has(role));
    if (missing.length > 0) {
      throw new ValidationError(
        missing.length === 1
          ? `Unknown playbook role "${missing[0]}". Create it in Roles before using it here.`
          : `Unknown playbook roles: ${missing.join(', ')}. Create them in Roles before using them here.`,
      );
    }
  }
}

function mergePlaybookInput(
  current: Record<string, unknown>,
  input: UpdatePlaybookInput,
): CreatePlaybookInput {
  return {
    name: input.name ?? String(current.name),
    slug: input.slug ?? String(current.slug),
    description:
      input.description === undefined
        ? asOptionalString(current.description)
        : input.description,
    outcome: input.outcome ?? String(current.outcome),
    lifecycle: input.lifecycle ?? readLifecycle(current.lifecycle),
    definition: input.definition ?? asRecord(current.definition),
  };
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readLifecycle(value: unknown): 'planned' | 'ongoing' | undefined {
  return value === 'ongoing' ? 'ongoing' : value === 'planned' ? 'planned' : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
