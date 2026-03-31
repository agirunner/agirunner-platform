import { describe, expect, it, vi } from 'vitest';

import { CommunityCatalogImportService } from '../../../src/services/community-catalog/community-catalog-import-service.js';

describe('CommunityCatalogImportService', () => {
  it('builds a batch preview with deduplicated artifacts and specialist override-only conflicts', async () => {
    const service = new CommunityCatalogImportService({
      sourceService: {
        loadSelection: vi.fn().mockResolvedValue(createSelection()),
      } as never,
      persistence: {
        findLatestLinksByCatalogIds: vi.fn().mockResolvedValue([]),
        createImportBatch: vi.fn(),
        upsertImportLink: vi.fn(),
      } as never,
      playbookService: {
        listPlaybooks: vi.fn().mockResolvedValue([
          { id: 'local-playbook-1', slug: 'bug-fix', name: 'Bug Fix', version: 1, definition: {}, lifecycle: 'planned' },
        ]),
        createPlaybook: vi.fn(),
        replacePlaybook: vi.fn(),
      } as never,
      specialistSkillService: {
        listSkills: vi.fn().mockResolvedValue([
          { id: 'local-skill-1', slug: 'bug-reproduction-discipline', name: 'Bug Reproduction Discipline' },
        ]),
        createSkill: vi.fn(),
        updateSkill: vi.fn(),
      } as never,
      roleDefinitionService: {
        listRoles: vi.fn().mockResolvedValue([{ id: 'local-role-1', name: 'Software Developer' }]),
        createRole: vi.fn(),
        updateRole: vi.fn(),
      } as never,
    });

    const preview = await service.previewImport('tenant-1', {
      playbookIds: ['bug-fix', 'hotfix'],
    });

    expect(preview.selectedPlaybooks).toHaveLength(2);
    expect(preview.referencedSpecialists).toEqual([
      expect.objectContaining({
        id: 'developer',
        name: 'Software Developer',
      }),
    ]);
    expect(preview.referencedSkills).toEqual([
      expect.objectContaining({
        id: 'bug-reproduction-discipline',
        name: 'Bug Reproduction Discipline',
      }),
    ]);
    expect(preview.referencedSpecialistCount).toBe(1);
    expect(preview.referencedSkillCount).toBe(1);
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'playbook:bug-fix',
          artifactType: 'playbook',
          availableActions: ['create_new', 'override_existing'],
        }),
        expect.objectContaining({
          key: 'skill:bug-reproduction-discipline',
          artifactType: 'skill',
          availableActions: ['create_new', 'override_existing'],
        }),
        expect.objectContaining({
          key: 'specialist:developer',
          artifactType: 'specialist',
          availableActions: ['override_existing'],
        }),
      ]),
    );
  });

  it('imports selected playbooks, expands tool profiles, and records provenance links', async () => {
    const persistence = {
      findLatestLinksByCatalogIds: vi.fn().mockResolvedValue([]),
      createImportBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
      upsertImportLink: vi.fn().mockResolvedValue(undefined),
    };
    const playbookService = {
      listPlaybooks: vi.fn().mockResolvedValue([
        { id: 'local-playbook-1', slug: 'bug-fix', name: 'Bug Fix', version: 1, definition: {}, lifecycle: 'planned' },
      ]),
      createPlaybook: vi.fn(),
      replacePlaybook: vi.fn().mockResolvedValue({ id: 'local-playbook-2', name: 'Bug Fix', slug: 'bug-fix', version: 2 }),
    };
    const specialistSkillService = {
      listSkills: vi.fn().mockResolvedValue([
        { id: 'local-skill-1', slug: 'bug-reproduction-discipline', name: 'Bug Reproduction Discipline' },
      ]),
      createSkill: vi.fn(),
      updateSkill: vi.fn().mockResolvedValue({ id: 'local-skill-1', name: 'Bug Reproduction Discipline' }),
    };
    const roleDefinitionService = {
      listRoles: vi.fn().mockResolvedValue([{ id: 'local-role-1', name: 'Software Developer' }]),
      createRole: vi.fn(),
      updateRole: vi.fn().mockResolvedValue({ id: 'local-role-1', name: 'Software Developer' }),
    };
    const service = new CommunityCatalogImportService({
      sourceService: {
        loadSelection: vi.fn().mockResolvedValue(createSelection({ packageIds: ['bug-fix'] })),
      } as never,
      persistence: persistence as never,
      playbookService: playbookService as never,
      specialistSkillService: specialistSkillService as never,
      roleDefinitionService: roleDefinitionService as never,
    });

    const result = await service.importPlaybooks('tenant-1', {
      playbookIds: ['bug-fix'],
      defaultConflictResolution: 'override_existing',
      conflictResolutions: {},
    });

    expect(specialistSkillService.updateSkill).toHaveBeenCalledWith(
      'tenant-1',
      'local-skill-1',
      expect.objectContaining({
        name: 'Bug Reproduction Discipline',
        slug: 'bug-reproduction-discipline',
        summary: 'Bound a defect before changing code.',
      }),
    );
    expect(roleDefinitionService.updateRole).toHaveBeenCalledWith(
      'tenant-1',
      'local-role-1',
      expect.objectContaining({
        name: 'Software Developer',
        allowedTools: ['file_read', 'shell_exec', 'submit_handoff'],
        skillIds: ['local-skill-1'],
      }),
    );
    expect(playbookService.replacePlaybook).toHaveBeenCalledWith(
      'tenant-1',
      'local-playbook-1',
      expect.objectContaining({
        name: 'Bug Fix',
        slug: 'bug-fix',
      }),
    );
    expect(persistence.createImportBatch).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        repository: 'agirunner/agirunner-playbooks',
        ref: 'main',
        playbookIds: ['bug-fix'],
      }),
    );
    expect(persistence.upsertImportLink).toHaveBeenCalledTimes(3);
    expect(result.importedPlaybooks).toEqual([
      expect.objectContaining({
        catalogId: 'bug-fix',
        localEntityId: 'local-playbook-2',
      }),
    ]);
  });
});

function createSelection(input?: { packageIds?: string[] }) {
  const ids = input?.packageIds ?? ['bug-fix', 'hotfix'];
  return {
    repository: 'agirunner/agirunner-playbooks',
    ref: 'main',
    toolProfiles: {
      'all-specialist-tools': ['file_read', 'shell_exec', 'submit_handoff'],
    },
    packages: ids.map((id) => ({
      playbook: {
        id,
        path: `playbooks/engineering/${id}/playbook.yaml`,
        readmePath: `playbooks/engineering/${id}/README.md`,
        readme: `# ${id}`,
        name: id === 'bug-fix' ? 'Bug Fix' : 'Hotfix',
        slug: id,
        version: '1.0.0',
        category: 'engineering',
        stability: 'experimental',
        description: 'Diagnose and fix a bounded defect.',
        outcome: 'A bounded defect is fixed.',
        lifecycle: 'planned',
        specialistIds: ['developer'],
        definition: {
          process_instructions: 'Preferred flow: Software Developer implements the fix.',
          roles: ['Software Developer'],
          stages: [{ name: 'implementation', goal: 'Implement the fix', involves: ['Software Developer'] }],
          board: { entry_column_id: 'planned', columns: [{ id: 'planned', label: 'Planned' }] },
          parameters: [{ slug: 'issue_summary', title: 'Issue Summary', required: true }],
          lifecycle: 'planned',
        },
      },
      specialists: [
        {
          id: 'developer',
          path: 'specialists/engineering/developer/specialist.yaml',
          name: 'Software Developer',
          category: 'engineering',
          stability: 'experimental',
          description: 'Implements scoped code or configuration changes.',
          allowedTools: 'all-specialist-tools',
          skillIds: ['bug-reproduction-discipline'],
          systemPrompt: 'You are the Software Developer.',
        },
      ],
      skills: [
        {
          id: 'bug-reproduction-discipline',
          path: 'skills/engineering/bug-reproduction-discipline/SKILL.md',
          name: 'Bug Reproduction Discipline',
          category: 'engineering',
          stability: 'experimental',
          summary: 'Bound a defect before changing code.',
          content: '# Bug Reproduction Discipline\n\n## Purpose\nBound the defect first.',
        },
      ],
    })),
  };
}
