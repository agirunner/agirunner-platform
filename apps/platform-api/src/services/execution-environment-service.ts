import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { DatabaseQueryable } from '../db/database.js';
import {
  type ExecutionContainerContract,
  type ExecutionEnvironmentSnapshot,
  type ExecutionEnvironmentSummary,
  normalizeStringArray,
} from './execution-environment-contract.js';
import type { ExecutionEnvironmentCatalogService } from './execution-environment-catalog-service.js';
import { buildCatalogSeedVerification } from './execution-environment-baseline.js';
import {
  handleEnvironmentWriteError,
  listEnvironmentsSql,
  mergeEnvironmentUpdate,
  normalizeOptionalString,
  normalizeSlug,
  readClaimableEnvironmentRow,
  readRoleScopedEnvironmentId,
  toExecutionEnvironmentRecord,
  toExecutionEnvironmentSummary,
  validateEnvironmentInput,
} from './execution-environment-service-support.js';
import type {
  CreateExecutionEnvironmentFromCatalogInput,
  CreateExecutionEnvironmentInput,
  ExecutionEnvironmentRecord,
  ExecutionEnvironmentRow,
  InsertExecutionEnvironmentInput,
  UpdateExecutionEnvironmentInput,
} from './execution-environment-service.types.js';

export type {
  CreateExecutionEnvironmentFromCatalogInput,
  CreateExecutionEnvironmentInput,
  ExecutionEnvironmentRecord,
  ExecutionEnvironmentRow,
  UpdateExecutionEnvironmentInput,
} from './execution-environment-service.types.js';

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
    input: InsertExecutionEnvironmentInput,
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
