import pg from 'pg';
import { expect, type Page } from '@playwright/test';

import { PLATFORM_API_URL, ADMIN_API_KEY } from './platform-env.js';
import {
  COMMUNITY_CATALOG_DATABASE_URL,
  COMMUNITY_CATALOG_FIXTURE_BASE_URL,
  COMMUNITY_CATALOG_FIXTURE_REF,
  COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
} from './community-catalog-stack.constants.js';
import { CommunityCatalogSourceService } from '../../../../apps/platform-api/src/services/community-catalog/community-catalog-source.js';
import { createDefaultPlaybookBoard } from '../../../../packages/sdk/src/playbooks/default-board.js';
import type {
  CommunityCatalogImportResult,
  CommunityCatalogSelection,
} from '../../../../apps/platform-api/src/services/community-catalog/community-catalog-types.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: COMMUNITY_CATALOG_DATABASE_URL });

export type CatalogSelectionMode =
  | { mode: 'single'; playbookId: string }
  | { mode: 'category'; category: string }
  | { mode: 'all' };

interface ImportLinkRow {
  artifact_type: 'playbook' | 'specialist' | 'skill';
  catalog_id: string;
  local_entity_id: string;
}

export interface LoadedCatalogSelection {
  request: CatalogSelectionMode;
  sourceSelection: CommunityCatalogSelection;
  playbooks: Array<{
    catalogId: string;
    name: string;
    version: string;
    localEntityId?: string;
  }>;
}

export async function resetCommunityCatalogState(): Promise<void> {
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

export async function closeCommunityCatalogPool(): Promise<void> {
  await pool.end();
}

export async function loadCatalogSelection(request: CatalogSelectionMode): Promise<LoadedCatalogSelection> {
  const source = createCatalogSource();
  const manifest = await source.listPlaybooks();
  const playbookIds = resolvePlaybookIds(request, manifest);
  const sourceSelection = await source.loadSelection(playbookIds);

  return {
    request,
    sourceSelection,
    playbooks: sourceSelection.packages.map((pkg) => ({
      catalogId: pkg.playbook.id,
      name: pkg.playbook.name,
      version: pkg.playbook.version,
    })),
  };
}

export async function importCatalogPlaybooks(
  page: Page,
  selection: LoadedCatalogSelection,
): Promise<CommunityCatalogImportResult> {
  await page.goto('/design/playbooks');
  await page.getByRole('button', { name: 'Add Community Playbooks' }).click();
  await expect(page.getByRole('heading', { name: 'Add Community Playbooks' })).toBeVisible();

  if (selection.request.mode === 'category') {
    await page.getByLabel('Catalog category').click();
    await page.getByRole('option', { name: selection.request.category }).click();
  }

  if (selection.request.mode === 'single') {
    const playbookId = selection.request.playbookId;
    await page.getByTestId(`community-playbook-select-${playbookId}`).click();
  } else {
    await page.getByRole('button', { name: 'Select all filtered' }).click();
  }

  await expect(page.getByText(`${selection.sourceSelection.packages.length} selected`)).toBeVisible();
  const importResponsePromise = page.waitForResponse((response) => {
    return response.request().method() === 'POST' && response.url().endsWith('/api/v1/community-catalog/import');
  });

  await page.getByRole('button', { name: 'Import selected' }).click();

  const importResponse = await importResponsePromise;
  expect(importResponse.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Add Community Playbooks' })).toHaveCount(0);

  const payload = (await importResponse.json()) as { data: CommunityCatalogImportResult };
  return payload.data;
}

export async function assertImportedCatalogSelectionMatchesRepo(
  selection: LoadedCatalogSelection,
  importResult: CommunityCatalogImportResult,
): Promise<void> {
  const links = await loadImportLinks(importResult.importBatchId);
  const expectedSkills = uniqueBy(
    selection.sourceSelection.packages.flatMap((pkg) => pkg.skills),
    (skill) => skill.id,
  );
  const expectedSpecialists = uniqueBy(
    selection.sourceSelection.packages.flatMap((pkg) => pkg.specialists),
    (specialist) => specialist.id,
  );

  expect(filterLinks(links, 'playbook')).toHaveLength(selection.sourceSelection.packages.length);
  expect(filterLinks(links, 'specialist')).toHaveLength(expectedSpecialists.length);
  expect(filterLinks(links, 'skill')).toHaveLength(expectedSkills.length);

  const skillIdByCatalogId = new Map<string, string>();
  for (const skill of expectedSkills) {
    const link = requireLink(links, 'skill', skill.id);
    skillIdByCatalogId.set(skill.id, link.local_entity_id);
    const local = await apiRequest<{
      id: string;
      name: string;
      slug: string;
      summary: string;
      content: string;
    }>(`/api/v1/specialist-skills/${link.local_entity_id}`);
    expect(local.name).toBe(skill.name);
    expect(local.summary).toBe(skill.summary);
    expect(local.content).toBe(skill.content);
  }

  for (const specialist of expectedSpecialists) {
    const link = requireLink(links, 'specialist', specialist.id);
    const local = await apiRequest<{
      name: string;
      description: string | null;
      system_prompt: string;
      allowed_tools: string[];
      skill_ids: string[];
      is_active: boolean;
    }>(`/api/v1/config/roles/${link.local_entity_id}`);
    expect(local.name).toBe(specialist.name);
    expect(local.description ?? '').toBe(specialist.description);
    expect(local.system_prompt).toBe(specialist.systemPrompt);
    expect([...local.allowed_tools].sort()).toEqual(
      [...resolveAllowedTools(selection.sourceSelection, specialist.allowedTools)].sort(),
    );
    expect([...local.skill_ids].sort()).toEqual(
      specialist.skillIds.map((skillId) => skillIdByCatalogId.get(skillId)!).sort(),
    );
    expect(local.is_active).toBe(true);
  }

  for (const pkg of selection.sourceSelection.packages) {
    const link = requireLink(links, 'playbook', pkg.playbook.id);
    const trackedPlaybook = selection.playbooks.find((entry) => entry.catalogId === pkg.playbook.id);
    if (trackedPlaybook) {
      trackedPlaybook.localEntityId = link.local_entity_id;
    }

    const local = await apiRequest<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      outcome: string;
      lifecycle: 'planned' | 'ongoing';
      version: number;
      definition: Record<string, unknown>;
    }>(`/api/v1/playbooks/${link.local_entity_id}`);
    expect(local.name).toBe(pkg.playbook.name);
    expect(local.description ?? '').toBe(pkg.playbook.description);
    expect(local.outcome).toBe(pkg.playbook.outcome);
    expect(local.lifecycle).toBe(pkg.playbook.lifecycle);
    expect(local.version).toBe(1);
    expect(normalizeDefinition(local.definition)).toEqual(normalizeDefinition(pkg.playbook.definition));

    const origin = await apiRequest<{
      catalogId: string;
      catalogName: string;
      catalogVersion: string | null;
    }>(`/api/v1/community-catalog/imported-playbooks/${link.local_entity_id}/origin`);
    expect(origin).toEqual({
      catalogId: pkg.playbook.id,
      catalogName: pkg.playbook.name,
      catalogVersion: pkg.playbook.version,
    });
  }
}

function createCatalogSource(): CommunityCatalogSourceService {
  return new CommunityCatalogSourceService({
    repository: COMMUNITY_CATALOG_FIXTURE_REPOSITORY,
    ref: COMMUNITY_CATALOG_FIXTURE_REF,
    rawBaseUrl: COMMUNITY_CATALOG_FIXTURE_BASE_URL,
  });
}

function resolvePlaybookIds(
  request: CatalogSelectionMode,
  manifest: Awaited<ReturnType<CommunityCatalogSourceService['listPlaybooks']>>,
): string[] {
  if (request.mode === 'single') {
    return [request.playbookId];
  }
  if (request.mode === 'category') {
    return manifest
      .filter((entry) => entry.category === request.category)
      .map((entry) => entry.id);
  }
  return manifest.map((entry) => entry.id);
}

async function loadImportLinks(importBatchId: string): Promise<ImportLinkRow[]> {
  const result = await pool.query<ImportLinkRow>(
    `SELECT artifact_type, catalog_id, local_entity_id
       FROM catalog_import_links
      WHERE import_batch_id = $1
      ORDER BY artifact_type, catalog_id`,
    [importBatchId],
  );
  return result.rows;
}

function filterLinks(links: ImportLinkRow[], artifactType: ImportLinkRow['artifact_type']): ImportLinkRow[] {
  return links.filter((entry) => entry.artifact_type === artifactType);
}

function requireLink(
  links: ImportLinkRow[],
  artifactType: ImportLinkRow['artifact_type'],
  catalogId: string,
): ImportLinkRow {
  const link = links.find((entry) => entry.artifact_type === artifactType && entry.catalog_id === catalogId);
  if (!link) {
    throw new Error(`Missing import link for ${artifactType}:${catalogId}`);
  }
  return link;
}

function resolveAllowedTools(
  selection: CommunityCatalogSelection,
  allowedTools: string[] | string,
): string[] {
  if (Array.isArray(allowedTools)) {
    return allowedTools;
  }
  return selection.toolProfiles[allowedTools] ?? [];
}

function uniqueBy<T>(items: T[], selectKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const uniqueItems: T[] = [];
  for (const item of items) {
    const key = selectKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueItems.push(item);
  }
  return uniqueItems;
}

function normalizeDefinition(definition: Record<string, unknown>): Record<string, unknown> {
  const normalized = structuredClone(definition);
  const processInstructions = normalized.process_instructions;
  if (typeof processInstructions === 'string') {
    normalized.process_instructions = processInstructions.trim();
  }
  if (!normalized.board || typeof normalized.board !== 'object' || Array.isArray(normalized.board)) {
    normalized.board = createDefaultPlaybookBoard() as unknown as Record<string, unknown>;
  }
  return normalized;
}

async function apiRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${path}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}
