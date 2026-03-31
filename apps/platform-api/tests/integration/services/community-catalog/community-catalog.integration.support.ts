import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../../../src/bootstrap/app.js';
import { DEFAULT_TENANT_ID } from '../../../../src/db/seed.js';
import { PlaybookService } from '../../../../src/services/playbook-service.js';
import { RoleDefinitionService } from '../../../../src/services/role-definition-service.js';
import { SpecialistSkillService } from '../../../../src/services/specialist-skill-service.js';
import { CommunityCatalogSourceService } from '../../../../src/services/community-catalog/community-catalog-source.js';
import type {
  CommunityCatalogImportResult,
  CommunityCatalogSelection,
} from '../../../../src/services/community-catalog/community-catalog-types.js';
import {
  isContainerRuntimeAvailable,
  startTestDatabase,
  stopTestDatabase,
  type TestDatabase,
} from '../../db/postgres.js';
import {
  startCommunityCatalogFixtureServer,
  type CommunityCatalogFixtureServer,
} from './fixture-http-server.js';

const ADMIN_API_KEY = 'integration-community-catalog-admin-key';
const REQUIRED_ENV = {
  NODE_ENV: 'test',
  DEFAULT_ADMIN_API_KEY: ADMIN_API_KEY,
  JWT_SECRET: 'community-catalog-jwt-secret-32-bytes-minimum',
  WEBHOOK_ENCRYPTION_KEY: 'community-catalog-webhook-secret-32bytes',
} as const;

interface ImportLinkRow {
  artifact_type: 'playbook' | 'specialist' | 'skill';
  catalog_id: string;
  local_entity_id: string;
  import_batch_id: string;
}

export interface CommunityCatalogIntegrationSuite {
  app?: FastifyInstance;
  canRunIntegration: boolean;
  catalogSource?: CommunityCatalogSourceService;
  db?: TestDatabase;
  playbookService?: PlaybookService;
  roleDefinitionService?: RoleDefinitionService;
  specialistSkillService?: SpecialistSkillService;
  resetState(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function setupCommunityCatalogIntegrationSuite(): Promise<CommunityCatalogIntegrationSuite> {
  if (!isContainerRuntimeAvailable()) {
    return {
      canRunIntegration: false,
      async resetState() {},
      async cleanup() {},
    };
  }

  let db: TestDatabase | undefined;
  let app: FastifyInstance | undefined;
  let fixtureServer: CommunityCatalogFixtureServer | undefined;
  let restoreEnv: (() => void) | undefined;

  try {
    db = await startTestDatabase();
    fixtureServer = await startCommunityCatalogFixtureServer();
    restoreEnv = applyEnv({
      DATABASE_URL: db.databaseUrl,
      COMMUNITY_CATALOG_REPOSITORY: fixtureServer.repository,
      COMMUNITY_CATALOG_REF: fixtureServer.ref,
      COMMUNITY_CATALOG_RAW_BASE_URL: fixtureServer.baseUrl,
    });
    app = await buildApp();
    await app.ready();

    return {
      app,
      canRunIntegration: true,
      catalogSource: new CommunityCatalogSourceService({
        repository: fixtureServer.repository,
        ref: fixtureServer.ref,
        rawBaseUrl: fixtureServer.baseUrl,
      }),
      db,
      playbookService: new PlaybookService(db.pool),
      roleDefinitionService: new RoleDefinitionService(db.pool),
      specialistSkillService: new SpecialistSkillService(db.pool),
      async resetState() {
        await resetCommunityCatalogTenantState(db!.pool);
      },
      async cleanup() {
        if (app) {
          await app.close();
        }
        if (fixtureServer) {
          await fixtureServer.stop();
        }
        if (restoreEnv) {
          restoreEnv();
        }
        if (db) {
          await stopTestDatabase(db);
        }
      },
    };
  } catch (error) {
    if (app) {
      await app.close().catch(() => undefined);
    }
    if (fixtureServer) {
      await fixtureServer.stop().catch(() => undefined);
    }
    restoreEnv?.();
    if (db) {
      await stopTestDatabase(db).catch(() => undefined);
    }
    throw error;
  }
}

export async function apiRequest<T>(
  app: FastifyInstance,
  input: {
    method: 'GET' | 'POST';
    url: string;
    body?: Record<string, unknown>;
    expectedStatus?: number;
  },
): Promise<T> {
  const response = await app.inject({
    method: input.method,
    url: input.url,
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
    },
    payload: input.body,
  });

  const expectedStatus = input.expectedStatus ?? 200;
  if (response.statusCode !== expectedStatus) {
    throw new Error(
      `Expected ${input.method} ${input.url} to return ${expectedStatus}, got ${response.statusCode}: ${response.body}`,
    );
  }

  return (response.json() as { data: T }).data;
}

export async function loadImportLinks(
  db: TestDatabase,
  importBatchId: string,
): Promise<ImportLinkRow[]> {
  const result = await db.pool.query<ImportLinkRow>(
    `SELECT artifact_type, catalog_id, local_entity_id, import_batch_id
       FROM catalog_import_links
      WHERE tenant_id = $1
        AND import_batch_id = $2
      ORDER BY artifact_type, catalog_id`,
    [DEFAULT_TENANT_ID, importBatchId],
  );
  return result.rows;
}

export async function assertImportBatchMatchesSelection(
  suite: CommunityCatalogIntegrationSuite,
  selection: CommunityCatalogSelection,
  result: CommunityCatalogImportResult,
  options?: {
    expectedPlaybookVersion?: number;
    allowSlugSuffix?: boolean;
  },
): Promise<void> {
  const db = suite.db!;
  const playbookService = suite.playbookService!;
  const roleDefinitionService = suite.roleDefinitionService!;
  const specialistSkillService = suite.specialistSkillService!;
  const links = await loadImportLinks(db, result.importBatchId);
  const linkKey = (artifactType: string, catalogId: string) =>
    links.find((entry) => entry.artifact_type === artifactType && entry.catalog_id === catalogId);
  const expectedPlaybookVersion = options?.expectedPlaybookVersion ?? 1;
  const expectedSkills = uniqueBy(selection.packages.flatMap((pkg) => pkg.skills), (item) => item.id);
  const expectedSpecialists = uniqueBy(
    selection.packages.flatMap((pkg) => pkg.specialists),
    (item) => item.id,
  );

  expectLinks(links, 'playbook', selection.packages.length);
  expectLinks(links, 'specialist', expectedSpecialists.length);
  expectLinks(links, 'skill', expectedSkills.length);

  const skillIdByCatalogId = new Map<string, string>();
  for (const skill of expectedSkills) {
    const link = linkKey('skill', skill.id);
    if (!link) {
      throw new Error(`Missing imported skill link for ${skill.id}`);
    }
    skillIdByCatalogId.set(skill.id, link.local_entity_id);
    const local = await specialistSkillService.getSkill(DEFAULT_TENANT_ID, link.local_entity_id);
    expect(local.name).toBe(skill.name);
    expect(local.summary).toBe(skill.summary);
    expect(local.content).toBe(skill.content);
    expectSlug(local.slug, skill.id, options?.allowSlugSuffix ?? false);
  }

  for (const specialist of expectedSpecialists) {
    const link = linkKey('specialist', specialist.id);
    if (!link) {
      throw new Error(`Missing imported specialist link for ${specialist.id}`);
    }
    const local = await roleDefinitionService.getRoleById(DEFAULT_TENANT_ID, link.local_entity_id);
    const allowedTools = Array.isArray(specialist.allowedTools)
      ? specialist.allowedTools
      : selection.toolProfiles[specialist.allowedTools] ?? [];
    expect(local.name).toBe(specialist.name);
    expect(local.description).toBe(specialist.description);
    expect(local.system_prompt).toBe(specialist.systemPrompt);
    expect([...local.allowed_tools].sort()).toEqual([...allowedTools].sort());
    expect([...local.skill_ids].sort()).toEqual(
      specialist.skillIds.map((skillId) => skillIdByCatalogId.get(skillId)!).sort(),
    );
    expect(local.is_active).toBe(true);
  }

  for (const pkg of selection.packages) {
    const link = linkKey('playbook', pkg.playbook.id);
    if (!link) {
      throw new Error(`Missing imported playbook link for ${pkg.playbook.id}`);
    }
    const local = await playbookService.getPlaybook(DEFAULT_TENANT_ID, link.local_entity_id);
    expect(local.name).toBe(pkg.playbook.name);
    expect(local.description).toBe(pkg.playbook.description);
    expect(local.outcome).toBe(pkg.playbook.outcome);
    expect(local.lifecycle).toBe(pkg.playbook.lifecycle);
    expect(normalizeDefinitionForComparison(local.definition)).toEqual(
      normalizeDefinitionForComparison(pkg.playbook.definition),
    );
    expect(Number(local.version)).toBe(expectedPlaybookVersion);
    expectSlug(String(local.slug), pkg.playbook.slug, options?.allowSlugSuffix ?? false);
  }
}

async function resetCommunityCatalogTenantState(pool: TestDatabase['pool']): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE
       catalog_import_links,
       catalog_import_batches,
       specialist_skill_assignments,
       specialist_mcp_server_grants,
       playbooks,
       role_definitions,
       specialist_skills
     RESTART IDENTITY CASCADE`,
  );
}

function applyEnv(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  };
}

function expectLinks(
  links: ImportLinkRow[],
  artifactType: ImportLinkRow['artifact_type'],
  expectedCount: number,
): void {
  const actualCount = links.filter((entry) => entry.artifact_type === artifactType).length;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} ${artifactType} links in import batch, found ${actualCount}`,
    );
  }
}

function expectSlug(actual: string, expectedBase: string, allowSuffix: boolean): void {
  if (allowSuffix) {
    if (actual === expectedBase || actual.startsWith(`${expectedBase}-`)) {
      return;
    }
    throw new Error(`Expected slug ${actual} to equal or extend ${expectedBase}`);
  }
  if (actual !== expectedBase) {
    throw new Error(`Expected slug ${expectedBase}, received ${actual}`);
  }
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const currentKey = key(item);
    if (seen.has(currentKey)) {
      return false;
    }
    seen.add(currentKey);
    return true;
  });
}

function normalizeDefinitionForComparison(definition: unknown): unknown {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return definition;
  }

  const value = { ...(definition as Record<string, unknown>) };
  if (typeof value.process_instructions === 'string') {
    value.process_instructions = value.process_instructions.trim();
  }
  return value;
}
