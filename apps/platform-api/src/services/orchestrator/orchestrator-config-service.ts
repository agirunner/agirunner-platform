import type { DatabasePool } from '../../db/database.js';

export interface OrchestratorConfig {
  prompt: string;
  updatedAt: string;
}

export class OrchestratorConfigService {
  constructor(private readonly pool: DatabasePool) {}

  async get(tenantId: string): Promise<OrchestratorConfig> {
    const result = await this.pool.query<{ prompt: string; updated_at: Date }>(
      'SELECT prompt, updated_at FROM orchestrator_config WHERE tenant_id = $1',
      [tenantId],
    );

    if (result.rowCount === 0) {
      return { prompt: '', updatedAt: new Date().toISOString() };
    }

    const row = result.rows[0];
    return {
      prompt: row.prompt,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async upsert(tenantId: string, prompt: string): Promise<OrchestratorConfig> {
    const result = await this.pool.query<{ prompt: string; updated_at: Date }>(
      `INSERT INTO orchestrator_config (tenant_id, prompt, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET prompt = $2, updated_at = NOW()
       RETURNING prompt, updated_at`,
      [tenantId, prompt],
    );

    const row = result.rows[0];
    return {
      prompt: row.prompt,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
