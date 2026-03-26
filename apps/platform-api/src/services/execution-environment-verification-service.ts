import { NotFoundError } from '../errors/domain-errors.js';
import type { DatabaseQueryable } from '../db/database.js';
import type { ExecutionEnvironmentVerificationResult } from './execution-environment-contract.js';
import { ExecutionEnvironmentService } from './execution-environment-service.js';

export interface ExecutionEnvironmentVerifier {
  verify(input: {
    environmentId: string;
    image: string;
    cpu: string;
    memory: string;
    pullPolicy: 'always' | 'if-not-present' | 'never';
    bootstrapCommands: string[];
    bootstrapRequiredDomains: string[];
  }): Promise<ExecutionEnvironmentVerificationResult>;
}

export class ExecutionEnvironmentVerificationService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly environmentService: ExecutionEnvironmentService,
    private readonly verifier: ExecutionEnvironmentVerifier,
  ) {}

  async verifyEnvironment(tenantId: string, environmentId: string) {
    const environment = await this.environmentService.getEnvironment(tenantId, environmentId);
    const result = await this.verifier.verify({
      environmentId: environment.id,
      image: environment.image,
      cpu: environment.cpu,
      memory: environment.memory,
      pullPolicy: environment.pull_policy,
      bootstrapCommands: environment.bootstrap_commands,
      bootstrapRequiredDomains: environment.bootstrap_required_domains,
    });

    await this.pool.query(
      `INSERT INTO execution_environment_verifications (
         tenant_id,
         execution_environment_id,
         status,
         contract_version,
         image,
         probe_output,
         errors
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        tenantId,
        environmentId,
        result.compatibility_status,
        result.verification_contract_version,
        environment.image,
        JSON.stringify(result.probe_output),
        JSON.stringify(result.compatibility_errors),
      ],
    );

    await this.pool.query(
      `UPDATE execution_environments
          SET compatibility_status = $3,
              compatibility_errors = $4::jsonb,
              verification_contract_version = $5,
              last_verified_at = now(),
              verified_metadata = $6::jsonb,
              tool_capabilities = $7::jsonb,
              is_claimable = $8,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        environmentId,
        result.compatibility_status,
        JSON.stringify(result.compatibility_errors),
        result.verification_contract_version,
        JSON.stringify(result.verified_metadata),
        JSON.stringify(result.tool_capabilities),
        result.compatibility_status === 'compatible' && environment.support_status !== 'blocked',
      ],
    );

    return this.environmentService.getEnvironment(tenantId, environmentId);
  }

  async listVerificationHistory(tenantId: string, environmentId: string) {
    await this.environmentService.getEnvironment(tenantId, environmentId);
    const result = await this.pool.query(
      `SELECT *
         FROM execution_environment_verifications
        WHERE tenant_id = $1
          AND execution_environment_id = $2
        ORDER BY created_at DESC`,
      [tenantId, environmentId],
    );
    return result.rows;
  }

  async getLatestVerification(tenantId: string, environmentId: string) {
    const result = await this.pool.query(
      `SELECT *
         FROM execution_environment_verifications
        WHERE tenant_id = $1
          AND execution_environment_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, environmentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Execution environment verification not found');
    }
    return row;
  }
}
