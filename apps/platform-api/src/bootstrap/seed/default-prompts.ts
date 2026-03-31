import type { DatabaseQueryable } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';

export async function seedDefaultPrompts(db: DatabaseQueryable): Promise<void> {
  const { DEFAULT_PLATFORM_INSTRUCTIONS, DEFAULT_ORCHESTRATOR_PROMPT } = await import(
    '../../catalogs/default-prompts.js'
  );

  const existing = await db.query(
    'SELECT content FROM platform_instructions WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existing.rows[0]?.content?.trim()) {
    await db.query(
      `INSERT INTO platform_instructions (tenant_id, content, format, version)
       VALUES ($1, $2, 'markdown', 1)
       ON CONFLICT (tenant_id) DO UPDATE SET content = $2, version = platform_instructions.version + 1, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_PLATFORM_INSTRUCTIONS],
    );
    console.info('[seed] Seeded default platform instructions.');
  }

  const existingOrch = await db.query(
    'SELECT prompt FROM orchestrator_config WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existingOrch.rows[0]?.prompt?.trim()) {
    await db.query(
      `INSERT INTO orchestrator_config (tenant_id, prompt, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET prompt = $2, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_ORCHESTRATOR_PROMPT],
    );
    console.info('[seed] Seeded default orchestrator prompt.');
  }
}
