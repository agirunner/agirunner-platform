import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboardApi } from './index.js';
import { writeSession } from '../auth/session.js';
import { resetDashboardApiTestEnvironment } from './create-dashboard-api.test-support.js';

describe('dashboard api community catalog', () => {
  beforeEach(() => {
    resetDashboardApiTestEnvironment();
  });

  it('lists community catalog playbooks through the dashboard api', async () => {
    writeSession({ accessToken: 'catalog-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'bug-fix',
              name: 'Bug Fix',
              author: 'agirunner',
              category: 'engineering',
              stability: 'experimental',
              version: '1.0.0',
              summary: 'Diagnose and fix a bounded defect.',
              specialist_ids: ['developer'],
              path: 'playbooks/engineering/bug-fix/playbook.yaml',
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const playbooks = await api.listCommunityCatalogPlaybooks();

    expect(playbooks[0]?.id).toBe('bug-fix');
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/community-catalog/playbooks',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads community catalog playbook detail packages', async () => {
    writeSession({ accessToken: 'catalog-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            playbook: {
              id: 'bug-fix',
              path: 'playbooks/engineering/bug-fix/playbook.yaml',
              readmePath: 'playbooks/engineering/bug-fix/README.md',
              readme: '# Bug Fix',
              name: 'Bug Fix',
              author: 'agirunner',
              slug: 'bug-fix',
              version: '1.0.0',
              category: 'engineering',
              stability: 'experimental',
              description: 'Diagnose and fix a bounded defect.',
              outcome: 'A bounded defect is fixed.',
              lifecycle: 'planned',
              specialistIds: ['developer'],
              definition: {},
            },
            specialists: [],
            skills: [],
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const detail = await api.getCommunityCatalogPlaybookDetail('bug-fix');

    expect(detail.playbook.readme).toBe('# Bug Fix');
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/community-catalog/playbooks/bug-fix',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('previews and imports selected community catalog playbooks', async () => {
    writeSession({ accessToken: 'catalog-token', tenantId: 'tenant-1' });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              repository: 'agirunner/agirunner-playbooks',
              ref: 'main',
              selectedPlaybooks: [],
              referencedSpecialists: [],
              referencedSkills: [],
              referencedSpecialistCount: 0,
              referencedSkillCount: 0,
              conflicts: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              importBatchId: 'batch-1',
              importedPlaybooks: [
                { catalogId: 'bug-fix', localEntityId: 'playbook-1', localSlug: 'bug-fix' },
              ],
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const preview = await api.previewCommunityCatalogImport({ playbook_ids: ['bug-fix'] });
    const result = await api.importCommunityCatalogPlaybooks({
      playbook_ids: ['bug-fix'],
      default_conflict_resolution: 'override_existing',
    });

    expect(preview.repository).toBe('agirunner/agirunner-playbooks');
    expect(result.importBatchId).toBe('batch-1');
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(
      'http://localhost:8080/api/v1/community-catalog/import-preview',
    );
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe(
      'http://localhost:8080/api/v1/community-catalog/import',
    );
  });

  it('loads community catalog origin metadata for imported playbooks', async () => {
    writeSession({ accessToken: 'catalog-token', tenantId: 'tenant-1' });

    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            catalogId: 'bug-fix',
            catalogName: 'Bug Fix',
            catalogVersion: '1.0.0',
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const api = createDashboardApi({
      client: {} as never,
      fetcher,
      baseUrl: 'http://localhost:8080',
    });

    const origin = await api.getCommunityCatalogPlaybookOrigin('playbook-1');

    expect(origin.catalogId).toBe('bug-fix');
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:8080/api/v1/community-catalog/imported-playbooks/playbook-1/origin',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
