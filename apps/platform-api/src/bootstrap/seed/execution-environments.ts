import type { DatabaseQueryable } from '../../db/database.js';
import { DEFAULT_TENANT_ID } from '../../db/seed.js';
import { buildCatalogSeedVerification } from '../../services/execution-environment/baseline.js';
import {
  BUILT_IN_EXECUTION_ENVIRONMENT_CATALOG,
  DEFAULT_EXECUTION_ENVIRONMENT_CATALOG_KEY,
} from '../../services/execution-environment/starters.js';

export async function seedExecutionEnvironmentCatalogAndDefaults(
  db: DatabaseQueryable,
): Promise<void> {
  await seedExecutionEnvironmentCatalog(db);
  await seedDefaultTenantExecutionEnvironments(db);
}

async function seedExecutionEnvironmentCatalog(db: DatabaseQueryable): Promise<void> {
  for (const starter of BUILT_IN_EXECUTION_ENVIRONMENT_CATALOG) {
    await db.query(
      `INSERT INTO execution_environment_catalog (
         catalog_key,
         catalog_version,
         name,
         description,
         image,
         cpu,
         memory,
         pull_policy,
         bootstrap_commands,
         bootstrap_required_domains,
         declared_metadata,
         support_status,
         replacement_catalog_key,
         replacement_catalog_version
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14
       )
       ON CONFLICT (catalog_key, catalog_version) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             image = EXCLUDED.image,
             cpu = EXCLUDED.cpu,
             memory = EXCLUDED.memory,
             pull_policy = EXCLUDED.pull_policy,
             bootstrap_commands = EXCLUDED.bootstrap_commands,
             bootstrap_required_domains = EXCLUDED.bootstrap_required_domains,
             declared_metadata = EXCLUDED.declared_metadata,
             support_status = EXCLUDED.support_status,
             replacement_catalog_key = EXCLUDED.replacement_catalog_key,
             replacement_catalog_version = EXCLUDED.replacement_catalog_version`,
      [
        starter.catalog_key,
        starter.catalog_version,
        starter.name,
        starter.description,
        starter.image,
        starter.cpu,
        starter.memory,
        starter.pull_policy,
        JSON.stringify(starter.bootstrap_commands),
        JSON.stringify(starter.bootstrap_required_domains),
        JSON.stringify(starter.declared_metadata),
        starter.support_status,
        starter.replacement_catalog_key,
        starter.replacement_catalog_version,
      ],
    );
  }
}

async function seedDefaultTenantExecutionEnvironments(db: DatabaseQueryable): Promise<void> {
  const defaultEnvironmentResult = await db.query<{ id: string }>(
    `SELECT id
       FROM execution_environments
      WHERE tenant_id = $1
        AND is_default = true
      LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  const hasDefaultEnvironment = (defaultEnvironmentResult.rowCount ?? 0) > 0;

  for (const starter of BUILT_IN_EXECUTION_ENVIRONMENT_CATALOG) {
    const seededVerification = buildCatalogSeedVerification(starter);
    const shouldBeDefault = !hasDefaultEnvironment
      && starter.catalog_key === DEFAULT_EXECUTION_ENVIRONMENT_CATALOG_KEY;

    await db.query(
      `INSERT INTO execution_environments (
         tenant_id,
         slug,
         name,
         description,
         source_kind,
         catalog_key,
         catalog_version,
         image,
         cpu,
         memory,
         pull_policy,
         bootstrap_commands,
         bootstrap_required_domains,
         operator_notes,
         declared_metadata,
         verified_metadata,
         tool_capabilities,
         compatibility_status,
         compatibility_errors,
         verification_contract_version,
         last_verified_at,
         is_default,
         is_archived,
         is_claimable
       ) VALUES (
         $1, $2, $3, $4, 'catalog', $5, $6, $7, $8, $9, $10,
         $11::jsonb, $12::jsonb, NULL, $13::jsonb, $14::jsonb, $15::jsonb,
         $16, $17::jsonb, $18, now(), $19, false, true
       )
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [
        DEFAULT_TENANT_ID,
        starter.catalog_key,
        starter.name,
        starter.description,
        starter.catalog_key,
        starter.catalog_version,
        starter.image,
        starter.cpu,
        starter.memory,
        starter.pull_policy,
        JSON.stringify(starter.bootstrap_commands),
        JSON.stringify(starter.bootstrap_required_domains),
        JSON.stringify(starter.declared_metadata),
        JSON.stringify(seededVerification.verified_metadata),
        JSON.stringify(seededVerification.tool_capabilities),
        seededVerification.compatibility_status,
        JSON.stringify(seededVerification.compatibility_errors),
        seededVerification.verification_contract_version,
        shouldBeDefault,
      ],
    );
  }

  if (!hasDefaultEnvironment) {
    await db.query(
      `UPDATE execution_environments
          SET is_default = true,
              updated_at = now()
        WHERE tenant_id = $1
          AND catalog_key = $2
          AND catalog_version = 1`,
      [DEFAULT_TENANT_ID, DEFAULT_EXECUTION_ENVIRONMENT_CATALOG_KEY],
    );
  }
}
