import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';

export interface CreatePlaybookInput {
  name: string;
  slug?: string;
  description?: string;
  outcome: string;
  lifecycle?: 'standard' | 'continuous';
  definition: Record<string, unknown>;
}

export interface UpdatePlaybookInput {
  name?: string;
  slug?: string;
  description?: string;
  outcome?: string;
  lifecycle?: 'standard' | 'continuous';
  definition?: Record<string, unknown>;
}

export class PlaybookService {
  constructor(private readonly pool: DatabasePool) {}

  async createPlaybook(tenantId: string, input: CreatePlaybookInput) {
    const definition = parsePlaybookDefinition(input.definition);
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
    return repo.findAllPaginated('playbooks', '*', [], [], 'created_at DESC', 500, 0);
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

  private async insertPlaybookVersion(
    tenantId: string,
    currentVersion: number,
    input: CreatePlaybookInput,
  ) {
    const definition = parsePlaybookDefinition(input.definition);
    const slug = normalizeSlug(input.slug ?? input.name);
    const lifecycle = input.lifecycle ?? definition.lifecycle;
    const normalizedDefinition = { ...definition, lifecycle };

    try {
      const result = await this.pool.query(
        `INSERT INTO playbooks (
           tenant_id, name, slug, description, outcome, lifecycle, version, definition
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
      return result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error, 'uq_playbooks_tenant_slug_version')) {
        throw new ConflictError('Playbook slug already exists');
      }
      throw error;
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

function readLifecycle(value: unknown): 'standard' | 'continuous' | undefined {
  return value === 'continuous' ? 'continuous' : value === 'standard' ? 'standard' : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
