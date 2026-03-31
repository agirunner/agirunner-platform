import { describe, expect, it, vi } from 'vitest';

import { CommunityCatalogSourceService } from '../../../src/services/community-catalog/community-catalog-source.js';

const PLAYBOOKS_YAML = `playbooks:
  - id: bug-fix
    name: Bug Fix
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Diagnose and fix a bounded defect.
    specialist_ids:
      - developer
    path: playbooks/engineering/bug-fix/playbook.yaml
`;

const SPECIALISTS_YAML = `specialists:
  - id: developer
    name: Software Developer
    category: engineering
    stability: experimental
    summary: Implements scoped changes.
    skill_ids:
      - bug-reproduction-discipline
    path: specialists/engineering/developer/specialist.yaml
`;

const SKILLS_YAML = `skills:
  - id: bug-reproduction-discipline
    name: Bug Reproduction Discipline
    category: engineering
    stability: experimental
    summary: Bound a defect before changing code.
    path: skills/engineering/bug-reproduction-discipline/SKILL.md
`;

const TOOL_PROFILES_YAML = `tool_profiles:
  - id: all-specialist-tools
    description: Enables the default specialist tool set.
    tools:
      - file_read
      - shell_exec
      - submit_handoff
`;

const PLAYBOOK_YAML = `id: bug-fix
version: 1.0.0
name: Bug Fix
slug: bug-fix
category: engineering
stability: experimental
description: Diagnose and fix a bounded defect.
outcome: A bounded defect is fixed or routed into an advisory package.
lifecycle: planned
specialist_ids:
  - developer
definition:
  outcome: A bounded defect is fixed or routed into an advisory package.
  process_instructions: |
    Preferred flow: reproduce, implement, verify, and close with explicit evidence.
  parameters:
    - slug: issue_summary
      title: Issue Summary
      required: true
  roles:
    - Software Developer
  board:
    entry_column_id: planned
    columns:
      - id: planned
        label: Planned
  stages:
    - name: reproduce
      goal: The defect is bounded.
      involves:
        - Software Developer
  lifecycle: planned
`;

const README_MD = `# Bug Fix

Use this playbook when a bounded defect needs implementation, verification, and closure evidence.
`;

const SPECIALIST_YAML = `id: developer
name: Software Developer
category: engineering
stability: experimental
description: Implements scoped code or configuration changes and records verification evidence.
allowed_tools: all-specialist-tools
skill_ids:
  - bug-reproduction-discipline
system_prompt: |
  You are the Software Developer.
`;

const SKILL_MD = `---
name: bug-reproduction-discipline
description: Use when a defect must be reproduced or tightly bounded before implementation.
---

# Bug Reproduction Discipline

## Purpose
Bound a defect before changing code.
`;

describe('CommunityCatalogSourceService', () => {
  it('lists playbooks from the GitHub-backed catalog manifest', async () => {
    const fetcher = createCatalogFetcher(async () => createTextResponse(PLAYBOOKS_YAML));
    const service = new CommunityCatalogSourceService({
      fetcher,
      repository: 'agirunner/agirunner-playbooks',
      ref: 'main',
      rawBaseUrl: 'https://raw.example.test',
    });

    const result = await service.listPlaybooks();

    expect(fetcher).toHaveBeenCalledWith(
      'https://raw.example.test/agirunner/agirunner-playbooks/main/catalog/playbooks.yaml',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'bug-fix',
        name: 'Bug Fix',
        version: '1.0.0',
        category: 'engineering',
        stability: 'experimental',
      }),
    ]);
  });

  it('loads a playbook package with referenced specialists, skills, and README content', async () => {
    const fetcher = createCatalogFetcher(async (input) => {
      const fixtures = new Map<string, string>([
        ['catalog/playbooks.yaml', PLAYBOOKS_YAML],
        ['catalog/specialists.yaml', SPECIALISTS_YAML],
        ['catalog/skills.yaml', SKILLS_YAML],
        ['catalog/tool-profiles.yaml', TOOL_PROFILES_YAML],
        ['playbooks/engineering/bug-fix/playbook.yaml', PLAYBOOK_YAML],
        ['playbooks/engineering/bug-fix/README.md', README_MD],
        ['specialists/engineering/developer/specialist.yaml', SPECIALIST_YAML],
        ['skills/engineering/bug-reproduction-discipline/SKILL.md', SKILL_MD],
      ]);
      const key = String(input).replace(
        'https://raw.example.test/agirunner/agirunner-playbooks/main/',
        '',
      );
      const value = fixtures.get(key);
      if (!value) {
        return new Response('not found', { status: 404 });
      }
      return createTextResponse(value);
    });
    const service = new CommunityCatalogSourceService({
      fetcher,
      repository: 'agirunner/agirunner-playbooks',
      ref: 'main',
      rawBaseUrl: 'https://raw.example.test',
    });

    const selection = await service.loadSelection(['bug-fix']);

    expect(selection.repository).toBe('agirunner/agirunner-playbooks');
    expect(selection.ref).toBe('main');
    expect(selection.packages).toHaveLength(1);
    expect(selection.toolProfiles).toEqual({
      'all-specialist-tools': ['file_read', 'shell_exec', 'submit_handoff'],
    });
    expect(selection.packages[0]?.playbook).toEqual(
      expect.objectContaining({
        id: 'bug-fix',
        slug: 'bug-fix',
        version: '1.0.0',
        readme: README_MD.trim(),
      }),
    );
    expect(selection.packages[0]?.specialists).toEqual([
      expect.objectContaining({
        id: 'developer',
        name: 'Software Developer',
        allowedTools: 'all-specialist-tools',
      }),
    ]);
    expect(selection.packages[0]?.skills).toEqual([
      expect.objectContaining({
        id: 'bug-reproduction-discipline',
        name: 'Bug Reproduction Discipline',
        summary: 'Bound a defect before changing code.',
      }),
    ]);
    expect(selection.packages[0]?.skills[0]?.content).toContain('# Bug Reproduction Discipline');
    expect(selection.packages[0]?.skills[0]?.content).not.toContain('description: Use when');
  });

  it('returns a single playbook detail package with readme, specialists, and skills', async () => {
    const fetcher = createCatalogFetcher(async (input) => {
      const fixtures = new Map<string, string>([
        ['catalog/playbooks.yaml', PLAYBOOKS_YAML],
        ['catalog/specialists.yaml', SPECIALISTS_YAML],
        ['catalog/skills.yaml', SKILLS_YAML],
        ['catalog/tool-profiles.yaml', TOOL_PROFILES_YAML],
        ['playbooks/engineering/bug-fix/playbook.yaml', PLAYBOOK_YAML],
        ['playbooks/engineering/bug-fix/README.md', README_MD],
        ['specialists/engineering/developer/specialist.yaml', SPECIALIST_YAML],
        ['skills/engineering/bug-reproduction-discipline/SKILL.md', SKILL_MD],
      ]);
      const key = String(input).replace(
        'https://raw.example.test/agirunner/agirunner-playbooks/main/',
        '',
      );
      const value = fixtures.get(key);
      if (!value) {
        return new Response('not found', { status: 404 });
      }
      return createTextResponse(value);
    });
    const service = new CommunityCatalogSourceService({
      fetcher,
      repository: 'agirunner/agirunner-playbooks',
      ref: 'main',
      rawBaseUrl: 'https://raw.example.test',
    });

    const detail = await service.getPlaybookDetail('bug-fix');

    expect(detail.playbook.readme).toBe(README_MD.trim());
    expect(detail.specialists).toHaveLength(1);
    expect(detail.skills).toHaveLength(1);
  });
});

function createTextResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function createCatalogFetcher(
  handler: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}
