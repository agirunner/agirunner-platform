import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { DatabaseQueryable } from '../db/database.js';
import {
  assertValidContainerCpu,
  assertValidContainerImage,
  assertValidContainerMemory,
} from './container-resource-validation.js';
import {
  buildExecutionEnvironmentAgentHint,
  EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
  type ExecutionContainerContract,
  type ExecutionEnvironmentSnapshot,
  type ExecutionEnvironmentSummary,
  isRecord,
  normalizeStringArray,
} from './execution-environment-contract.js';
import type { ExecutionEnvironmentCatalogService } from './execution-environment-catalog-service.js';
import { buildCatalogSeedVerification } from './execution-environment-baseline.js';

interface ExecutionEnvironmentRow {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string | null;
  source_kind: string;
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: string;
  bootstrap_commands: unknown;
  bootstrap_required_domains: unknown;
  operator_notes: string | null;
  declared_metadata: unknown;
  verified_metadata: unknown;
  tool_capabilities: unknown;
  compatibility_status: string;
  compatibility_errors: unknown;
  verification_contract_version: string | null;
  last_verified_at: Date | null;
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  created_at: Date;
  updated_at: Date;
  support_status: string | null;
  usage_count: number;
}

export interface ExecutionEnvironmentRecord extends ExecutionEnvironmentSummary {
  description: string | null;
  operator_notes: string | null;
  declared_metadata: Record<string, unknown>;
  compatibility_errors: string[];
  is_default: boolean;
  is_archived: boolean;
  is_claimable: boolean;
  last_verified_at: Date | null;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateExecutionEnvironmentInput {
  name: string;
  description?: string;
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: 'always' | 'if-not-present' | 'never';
  bootstrapCommands?: string[];
  bootstrapRequiredDomains?: string[];
  operatorNotes?: string;
}

export interface CreateExecutionEnvironmentFromCatalogInput {
  catalogKey: string;
  catalogVersion: number;
  name?: string;
  description?: string;
  operatorNotes?: string;
}

export interface UpdateExecutionEnvironmentInput {
  name?: string;
  description?: string | null;
  image?: string;
  cpu?: string;
  memory?: string;
  pullPolicy?: 'always' | 'if-not-present' | 'never';
  bootstrapCommands?: string[];
  bootstrapRequiredDomains?: string[];
  operatorNotes?: string | null;
}

export class ExecutionEnvironmentService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly catalogService: ExecutionEnvironmentCatalogService,
  ) {}

  async listEnvironments(tenantId: string): Promise<ExecutionEnvironmentRecord[]> {
    const result = await this.pool.query<ExecutionEnvironmentRow>(listEnvironmentsSql(), [tenantId]);
    return result.rows.map(toExecutionEnvironmentRecord);
  }

  async getEnvironment(tenantId: string, id: string): Promise<ExecutionEnvironmentRecord> {
    const result = await this.pool.query<ExecutionEnvironmentRow>(
      `${listEnvironmentsSql()} AND ee.id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Execution environment not found');
    }
    return toExecutionEnvironmentRecord(row);
  }

  async createEnvironment(
    tenantId: string,
    input: CreateExecutionEnvironmentInput,
  ): Promise<ExecutionEnvironmentRecord> {
    validateEnvironmentInput(input);
    return this.insertEnvironment(tenantId, {
      name: input.name,
      description: input.description ?? null,
      source_kind: 'custom',
      catalog_key: null,
      catalog_version: null,
      image: input.image.trim(),
      cpu: input.cpu.trim(),
      memory: input.memory.trim(),
      pull_policy: input.pullPolicy,
      bootstrap_commands: normalizeStringArray(input.bootstrapCommands),
      bootstrap_required_domains: normalizeStringArray(input.bootstrapRequiredDomains),
      operator_notes: normalizeOptionalString(input.operatorNotes),
      declared_metadata: {},
      support_status: null,
      compatibility_status: 'unknown',
      compatibility_errors: [],
      verification_contract_version: null,
      verified_metadata: {},
      tool_capabilities: {},
      is_claimable: false,
    });
  }

  async createFromCatalog(
    tenantId: string,
    input: CreateExecutionEnvironmentFromCatalogInput,
  ): Promise<ExecutionEnvironmentRecord> {
    const catalog = await this.catalogService.getCatalogEntry(input.catalogKey, input.catalogVersion);
    const seededVerification = buildCatalogSeedVerification(catalog);
    return this.insertEnvironment(tenantId, {
      name: normalizeOptionalString(input.name) ?? catalog.name,
      description: normalizeOptionalString(input.description) ?? catalog.description,
      source_kind: 'catalog',
      catalog_key: catalog.catalog_key,
      catalog_version: catalog.catalog_version,
      image: catalog.image,
      cpu: catalog.cpu,
      memory: catalog.memory,
      pull_policy: catalog.pull_policy,
      bootstrap_commands: catalog.bootstrap_commands,
      bootstrap_required_domains: catalog.bootstrap_required_domains,
      operator_notes: normalizeOptionalString(input.operatorNotes),
      declared_metadata: catalog.declared_metadata,
      support_status: catalog.support_status,
      compatibility_status: seededVerification.compatibility_status,
      compatibility_errors: seededVerification.compatibility_errors,
      verification_contract_version: seededVerification.verification_contract_version,
      verified_metadata: seededVerification.verified_metadata,
      tool_capabilities: seededVerification.tool_capabilities,
      is_claimable: seededVerification.is_claimable,
    });
  }

  async updateEnvironment(
    tenantId: string,
    id: string,
    input: UpdateExecutionEnvironmentInput,
  ): Promise<ExecutionEnvironmentRecord> {
    const current = await this.getEnvironment(tenantId, id);
    const next = mergeEnvironmentUpdate(current, input);
    validateEnvironmentInput(next);
    try {
      await this.pool.query(
        `UPDATE execution_environments
            SET name = $3,
                description = $4,
                image = $5,
                cpu = $6,
                memory = $7,
                pull_policy = $8,
                bootstrap_commands = $9::jsonb,
                bootstrap_required_domains = $10::jsonb,
                operator_notes = $11,
                compatibility_status = 'unknown',
                compatibility_errors = '[]'::jsonb,
                verification_contract_version = NULL,
                last_verified_at = NULL,
                verified_metadata = '{}'::jsonb,
                tool_capabilities = '{}'::jsonb,
                is_claimable = false,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [
          tenantId,
          id,
          next.name.trim(),
          normalizeOptionalString(next.description),
          next.image.trim(),
          next.cpu.trim(),
          next.memory.trim(),
          next.pullPolicy,
          JSON.stringify(normalizeStringArray(next.bootstrapCommands)),
          JSON.stringify(normalizeStringArray(next.bootstrapRequiredDomains)),
          normalizeOptionalString(next.operatorNotes),
        ],
      );
    } catch (error) {
      handleEnvironmentWriteError(error);
    }
    return this.getEnvironment(tenantId, id);
  }

  async setDefaultEnvironment(tenantId: string, id: string): Promise<ExecutionEnvironmentRecord> {
    const current = await this.getEnvironment(tenantId, id);
    if (!current.is_claimable || current.is_archived) {
      throw new ValidationError('Only claimable, unarchived execution environments can be set as default');
    }
    await this.pool.query(`UPDATE execution_environments SET is_default = false WHERE tenant_id = $1`, [tenantId]);
    await this.pool.query(
      `UPDATE execution_environments
          SET is_default = true,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, id],
    );
    return this.getEnvironment(tenantId, id);
  }

  async setArchived(
    tenantId: string,
    id: string,
    archived: boolean,
  ): Promise<ExecutionEnvironmentRecord> {
    const current = await this.getEnvironment(tenantId, id);
    const nextClaimable =
      archived
        ? false
        : current.compatibility_status === 'compatible' && current.support_status !== 'blocked';
    await this.pool.query(
      `UPDATE execution_environments
          SET is_archived = $3,
              is_claimable = $4,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, id, archived, nextClaimable],
    );
    return this.getEnvironment(tenantId, id);
  }

  async resolveTaskExecutionEnvironment(
    tenantId: string,
    roleName: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<{
    executionContainer: ExecutionContainerContract;
    executionEnvironment: ExecutionEnvironmentSummary;
    snapshot: ExecutionEnvironmentSnapshot;
  }> {
    const roleScoped = await readRoleScopedEnvironmentId(db, tenantId, roleName);
    const row = await readClaimableEnvironmentRow(db, tenantId, roleScoped);
    if (!row) {
      throw new ValidationError('No claimable Specialist Execution environment is configured for this role or tenant default');
    }
    const record = toExecutionEnvironmentRecord(row);
    return {
      executionContainer: {
        image: record.image,
        cpu: record.cpu,
        memory: record.memory,
        pull_policy: record.pull_policy,
      },
      executionEnvironment: toExecutionEnvironmentSummary(record),
      snapshot: toExecutionEnvironmentSummary(record),
    };
  }

  private async insertEnvironment(
    tenantId: string,
    input: {
      name: string;
      description: string | null;
      source_kind: 'catalog' | 'custom';
      catalog_key: string | null;
      catalog_version: number | null;
      image: string;
      cpu: string;
      memory: string;
      pull_policy: 'always' | 'if-not-present' | 'never';
      bootstrap_commands: string[];
      bootstrap_required_domains: string[];
      operator_notes: string | null;
      declared_metadata: Record<string, unknown>;
      support_status: 'active' | 'deprecated' | 'blocked' | null;
      compatibility_status: 'unknown' | 'compatible' | 'incompatible';
      compatibility_errors: string[];
      verification_contract_version: string | null;
      verified_metadata: Record<string, unknown>;
      tool_capabilities: Record<string, unknown>;
      is_claimable: boolean;
    },
  ): Promise<ExecutionEnvironmentRecord> {
    const slug = normalizeSlug(input.name);
    try {
      const result = await this.pool.query<{ id: string }>(
        `INSERT INTO execution_environments (
           tenant_id, slug, name, description, source_kind, catalog_key, catalog_version,
           image, cpu, memory, pull_policy, bootstrap_commands, bootstrap_required_domains,
           operator_notes, declared_metadata, compatibility_status, compatibility_errors,
           verification_contract_version, last_verified_at, is_default, is_archived,
           is_claimable, verified_metadata, tool_capabilities
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12::jsonb, $13::jsonb,
           $14, $15::jsonb, $16, $17::jsonb,
           $18, $19, false, false,
           $20, $21::jsonb, $22::jsonb
         )
         RETURNING id`,
        [
          tenantId,
          slug,
          input.name.trim(),
          input.description,
          input.source_kind,
          input.catalog_key,
          input.catalog_version,
          input.image,
          input.cpu,
          input.memory,
          input.pull_policy,
          JSON.stringify(input.bootstrap_commands),
          JSON.stringify(input.bootstrap_required_domains),
          input.operator_notes,
          JSON.stringify(input.declared_metadata),
          input.compatibility_status,
          JSON.stringify(input.compatibility_errors),
          input.verification_contract_version,
          input.compatibility_status === 'compatible' ? new Date() : null,
          input.is_claimable,
          JSON.stringify(input.verified_metadata),
          JSON.stringify(input.tool_capabilities),
        ],
      );
      return this.getEnvironment(tenantId, result.rows[0].id);
    } catch (error) {
      handleEnvironmentWriteError(error);
      throw error;
    }
  }
}

function listEnvironmentsSql(): string {
  return `SELECT
    ee.*,
    c.support_status,
    (
      SELECT COUNT(*)::int
        FROM role_definitions rd
       WHERE rd.tenant_id = ee.tenant_id
         AND rd.execution_environment_id = ee.id
    ) + (
      SELECT COUNT(*)::int
        FROM tasks t
       WHERE t.tenant_id = ee.tenant_id
         AND t.execution_environment_id = ee.id
    ) AS usage_count
  FROM execution_environments ee
  LEFT JOIN execution_environment_catalog c
    ON c.catalog_key = ee.catalog_key
   AND c.catalog_version = ee.catalog_version
  WHERE ee.tenant_id = $1`;
}

function toExecutionEnvironmentRecord(row: ExecutionEnvironmentRow): ExecutionEnvironmentRecord {
  const verifiedMetadata = isRecord(row.verified_metadata) ? row.verified_metadata : {};
  const toolCapabilities = isRecord(row.tool_capabilities) ? row.tool_capabilities : {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source_kind: row.source_kind === 'catalog' ? 'catalog' : 'custom',
    catalog_key: row.catalog_key,
    catalog_version: row.catalog_version,
    image: row.image,
    cpu: row.cpu,
    memory: row.memory,
    pull_policy: row.pull_policy === 'always' || row.pull_policy === 'never' ? row.pull_policy : 'if-not-present',
    bootstrap_commands: normalizeStringArray(row.bootstrap_commands),
    bootstrap_required_domains: normalizeStringArray(row.bootstrap_required_domains),
    compatibility_status: row.compatibility_status === 'compatible' || row.compatibility_status === 'incompatible' ? row.compatibility_status : 'unknown',
    support_status: row.support_status === 'deprecated' || row.support_status === 'blocked' ? row.support_status : row.source_kind === 'catalog' ? 'active' : null,
    verification_contract_version: row.verification_contract_version,
    verified_metadata: verifiedMetadata,
    tool_capabilities: toolCapabilities,
    agent_hint: buildExecutionEnvironmentAgentHint({
      name: row.name,
      image: row.image,
      verifiedMetadata,
      toolCapabilities,
    }),
    operator_notes: row.operator_notes,
    declared_metadata: isRecord(row.declared_metadata) ? row.declared_metadata : {},
    compatibility_errors: normalizeStringArray(row.compatibility_errors),
    is_default: row.is_default,
    is_archived: row.is_archived,
    is_claimable: row.is_claimable,
    last_verified_at: row.last_verified_at,
    usage_count: row.usage_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toExecutionEnvironmentSummary(record: ExecutionEnvironmentRecord): ExecutionEnvironmentSummary {
  return {
    id: record.id,
    name: record.name,
    source_kind: record.source_kind,
    catalog_key: record.catalog_key,
    catalog_version: record.catalog_version,
    image: record.image,
    cpu: record.cpu,
    memory: record.memory,
    pull_policy: record.pull_policy,
    compatibility_status: record.compatibility_status,
    support_status: record.support_status,
    verification_contract_version: record.verification_contract_version ?? EXECUTION_ENVIRONMENT_CONTRACT_VERSION,
    verified_metadata: record.verified_metadata,
    tool_capabilities: record.tool_capabilities,
    bootstrap_commands: record.bootstrap_commands,
    bootstrap_required_domains: record.bootstrap_required_domains,
    agent_hint: record.agent_hint,
  };
}

function mergeEnvironmentUpdate(
  current: ExecutionEnvironmentRecord,
  input: UpdateExecutionEnvironmentInput,
): CreateExecutionEnvironmentInput {
  return {
    name: input.name ?? current.name,
    description: input.description ?? current.description ?? undefined,
    image: input.image ?? current.image,
    cpu: input.cpu ?? current.cpu,
    memory: input.memory ?? current.memory,
    pullPolicy: input.pullPolicy ?? current.pull_policy,
    bootstrapCommands: input.bootstrapCommands ?? current.bootstrap_commands,
    bootstrapRequiredDomains: input.bootstrapRequiredDomains ?? current.bootstrap_required_domains,
    operatorNotes: input.operatorNotes ?? current.operator_notes ?? undefined,
  };
}

async function readRoleScopedEnvironmentId(
  db: DatabaseQueryable,
  tenantId: string,
  roleName: string,
): Promise<string | null> {
  const result = await db.query<{ execution_environment_id: string | null }>(
    `SELECT execution_environment_id
       FROM role_definitions
      WHERE tenant_id = $1
        AND name = $2
        AND is_active = true
      LIMIT 1`,
    [tenantId, roleName.trim()],
  );
  return result.rows[0]?.execution_environment_id ?? null;
}

async function readClaimableEnvironmentRow(
  db: DatabaseQueryable,
  tenantId: string,
  requestedId: string | null,
): Promise<ExecutionEnvironmentRow | null> {
  const result = await db.query<ExecutionEnvironmentRow>(
    `${listEnvironmentsSql()}
       AND ee.is_archived = false
       AND ee.is_claimable = true
       AND COALESCE(c.support_status, 'active') <> 'blocked'
       AND (
         ($2::uuid IS NOT NULL AND ee.id = $2::uuid)
         OR ($2::uuid IS NULL AND ee.is_default = true)
       )
     LIMIT 1`,
    [tenantId, requestedId],
  );
  return result.rows[0] ?? null;
}

function validateEnvironmentInput(input: CreateExecutionEnvironmentInput): void {
  if (!normalizeOptionalString(input.name)) {
    throw new ValidationError('Execution environment name is required');
  }
  assertValidContainerImage(input.image, 'Execution environment image');
  assertValidContainerCpu(input.cpu, 'Execution environment CPU');
  assertValidContainerMemory(input.memory, 'Execution environment memory');
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function handleEnvironmentWriteError(error: unknown): never {
  if (isUniqueViolation(error, 'uq_execution_environments_tenant_slug')) {
    throw new ConflictError('Execution environment name already exists');
  }
  throw error;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}
