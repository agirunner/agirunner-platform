import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  CommunityCatalogImportPreview,
  CommunityCatalogImportResult,
  CommunityCatalogPlaybookManifestEntry,
  CommunityCatalogPlaybookPackage,
} from '../../../../src/services/community-catalog/community-catalog-types.js';
import {
  apiRequest,
  assertImportBatchMatchesSelection,
  loadImportLinks,
  setupCommunityCatalogIntegrationSuite,
  type CommunityCatalogIntegrationSuite,
} from './community-catalog.integration.support.js';

let suite: CommunityCatalogIntegrationSuite;

beforeAll(async () => {
  suite = await setupCommunityCatalogIntegrationSuite();
}, 120_000);

beforeEach(async (context) => {
  if (!suite.canRunIntegration) {
    context.skip();
  }
  await suite.resetState();
});

afterAll(async () => {
  await suite.cleanup();
});

describe('community catalog import integration', () => {
  it('imports one selected playbook through the live routes and preserves catalog content', async () => {
    const manifest = await listCatalogPlaybooks();
    const playbookId = manifest[0]!.id;

    const detail = await apiRequest<CommunityCatalogPlaybookPackage>(suite.app!, {
      method: 'GET',
      url: `/api/v1/community-catalog/playbooks/${playbookId}`,
    });
    expect(detail.playbook.id).toBe(playbookId);
    expect(detail.playbook.readme.length).toBeGreaterThan(0);

    const preview = await previewImport([playbookId]);
    expect(preview.selectedPlaybooks.map((entry) => entry.id)).toEqual([playbookId]);
    expect(preview.conflicts).toEqual([]);

    const result = await importPlaybooks([playbookId]);
    const selection = await suite.catalogSource!.loadSelection([playbookId]);
    await assertImportBatchMatchesSelection(suite, selection, result);
  }, 120_000);

  it('imports a selected subset of catalog playbooks in one batch and preserves catalog content', async () => {
    const manifest = await listCatalogPlaybooks();
    const playbookIds = manifest.slice(0, 3).map((entry) => entry.id);

    const preview = await previewImport(playbookIds);
    expect(preview.selectedPlaybooks.map((entry) => entry.id)).toEqual(playbookIds);

    const result = await importPlaybooks(playbookIds);
    const selection = await suite.catalogSource!.loadSelection(playbookIds);
    await assertImportBatchMatchesSelection(suite, selection, result);
  }, 120_000);

  it('imports the full catalog in one batch and preserves every imported artifact', async () => {
    const manifest = await listCatalogPlaybooks();
    const playbookIds = manifest.map((entry) => entry.id);

    const result = await importPlaybooks(playbookIds);
    const selection = await suite.catalogSource!.loadSelection(playbookIds);
    await assertImportBatchMatchesSelection(suite, selection, result);
  }, 120_000);

  it('re-imports with override_existing and restores drifted local content back to the catalog', async () => {
    const manifest = await listCatalogPlaybooks();
    const playbookId = manifest[0]!.id;

    const firstImport = await importPlaybooks([playbookId]);
    const firstLinks = await loadImportLinks(suite.db!, firstImport.importBatchId);
    const selection = await suite.catalogSource!.loadSelection([playbookId]);
    const localPlaybookId = firstLinks.find((entry) => entry.artifact_type === 'playbook')!
      .local_entity_id;
    const localSpecialistId = firstLinks.find((entry) => entry.artifact_type === 'specialist')!
      .local_entity_id;
    const localSkillId = firstLinks.find((entry) => entry.artifact_type === 'skill')!.local_entity_id;

    await suite.db!.pool.query(
      `UPDATE playbooks
          SET outcome = 'Drifted outcome',
              description = 'Drifted description',
              definition = jsonb_set(definition, '{process_instructions}', to_jsonb('Drifted process instructions'::text))
        WHERE id = $1`,
      [localPlaybookId],
    );
    await suite.db!.pool.query(
      `UPDATE role_definitions
          SET description = 'Drifted role description',
              system_prompt = 'Drifted role prompt',
              allowed_tools = ARRAY['submit_handoff']::text[]
        WHERE id = $1`,
      [localSpecialistId],
    );
    await suite.db!.pool.query(
      `DELETE FROM specialist_skill_assignments
        WHERE specialist_id = $1`,
      [localSpecialistId],
    );
    await suite.db!.pool.query(
      `UPDATE specialist_skills
          SET summary = 'Drifted skill summary',
              content = 'Drifted skill content'
        WHERE id = $1`,
      [localSkillId],
    );

    const secondImport = await apiRequest<CommunityCatalogImportResult>(suite.app!, {
      method: 'POST',
      url: '/api/v1/community-catalog/import',
      body: {
        playbook_ids: [playbookId],
        default_conflict_resolution: 'override_existing',
      },
      expectedStatus: 201,
    });
    const secondLinks = await loadImportLinks(suite.db!, secondImport.importBatchId);

    expect(secondImport.importedPlaybooks).toHaveLength(1);
    expect(secondImport.importedPlaybooks[0]!.localEntityId).not.toBe(localPlaybookId);
    expect(secondImport.importedPlaybooks[0]!.localSlug).toBe(selection.packages[0]!.playbook.slug);
    expect(
      secondLinks.find((entry) => entry.artifact_type === 'specialist')!.local_entity_id,
    ).toBe(localSpecialistId);
    expect(secondLinks.find((entry) => entry.artifact_type === 'skill')!.local_entity_id).toBe(
      localSkillId,
    );

    await assertImportBatchMatchesSelection(suite, selection, secondImport, {
      expectedPlaybookVersion: 2,
    });
  }, 120_000);
});

async function listCatalogPlaybooks(): Promise<CommunityCatalogPlaybookManifestEntry[]> {
  const manifest = await apiRequest<CommunityCatalogPlaybookManifestEntry[]>(suite.app!, {
    method: 'GET',
    url: '/api/v1/community-catalog/playbooks',
  });
  expect(manifest.length).toBeGreaterThan(2);
  return manifest;
}

function previewImport(playbookIds: string[]): Promise<CommunityCatalogImportPreview> {
  return apiRequest<CommunityCatalogImportPreview>(suite.app!, {
    method: 'POST',
    url: '/api/v1/community-catalog/import-preview',
    body: { playbook_ids: playbookIds },
  });
}

function importPlaybooks(playbookIds: string[]): Promise<CommunityCatalogImportResult> {
  return apiRequest<CommunityCatalogImportResult>(suite.app!, {
    method: 'POST',
    url: '/api/v1/community-catalog/import',
    body: { playbook_ids: playbookIds },
    expectedStatus: 201,
  });
}
