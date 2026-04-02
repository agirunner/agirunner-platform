import { describe, expect, it, vi } from 'vitest';

import { CommunityCatalogSourceService } from '../../../src/services/community-catalog/community-catalog-source.js';

const MULTI_PLAYBOOKS_YAML = `playbooks:
  - id: bug-fix
    name: Bug Fix
    author: agirunner
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Diagnose and fix a bounded defect.
    specialist_ids:
      - developer
    path: playbooks/engineering/bug-fix/playbook.yaml
  - id: follow-up
    name: Follow Up
    author: agirunner
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Continue the bounded fix.
    specialist_ids:
      - developer
    path: playbooks/engineering/follow-up/playbook.yaml
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
author: agirunner
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

const FOLLOW_UP_PLAYBOOK_YAML = `id: follow-up
version: 1.0.0
name: Follow Up
author: agirunner
slug: follow-up
category: engineering
stability: experimental
description: Continue a bounded defect fix.
outcome: The bounded defect progresses with explicit evidence.
lifecycle: planned
specialist_ids:
  - developer
definition:
  outcome: The bounded defect progresses with explicit evidence.
  process_instructions: |
    Continue the fix with the same specialist contract.
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
    - name: implement
      goal: The bounded fix advances.
      involves:
        - Software Developer
  lifecycle: planned
`;

const FOLLOW_UP_README_MD = `# Follow Up

Use this playbook when the bounded defect already has initial evidence and needs the next implementation step.
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

describe('CommunityCatalogSourceService caching', () => {
  it('reuses cached shared specialist and skill files across multiple playbooks', async () => {
    const fetchCounts = new Map<string, number>();
    const fetcher = createCatalogFetcher(async (input) => {
      const fixtures = new Map<string, string>([
        ['catalog/playbooks.yaml', MULTI_PLAYBOOKS_YAML],
        ['catalog/specialists.yaml', SPECIALISTS_YAML],
        ['catalog/skills.yaml', SKILLS_YAML],
        ['catalog/tool-profiles.yaml', TOOL_PROFILES_YAML],
        ['playbooks/engineering/bug-fix/playbook.yaml', PLAYBOOK_YAML],
        ['playbooks/engineering/bug-fix/README.md', README_MD],
        ['playbooks/engineering/follow-up/playbook.yaml', FOLLOW_UP_PLAYBOOK_YAML],
        ['playbooks/engineering/follow-up/README.md', FOLLOW_UP_README_MD],
        ['specialists/engineering/developer/specialist.yaml', SPECIALIST_YAML],
        ['skills/engineering/bug-reproduction-discipline/SKILL.md', SKILL_MD],
      ]);
      const key = String(input).replace(
        'https://raw.example.test/agirunner/agirunner-playbooks/main/',
        '',
      );
      fetchCounts.set(key, (fetchCounts.get(key) ?? 0) + 1);
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

    const selection = await service.loadSelection(['bug-fix', 'follow-up']);

    expect(selection.packages).toHaveLength(2);
    expect(fetchCounts.get('specialists/engineering/developer/specialist.yaml')).toBe(1);
    expect(fetchCounts.get('skills/engineering/bug-reproduction-discipline/SKILL.md')).toBe(1);
  });

  it('preserves upstream rate-limit status when fetches are throttled', async () => {
    const service = new CommunityCatalogSourceService({
      fetcher: createCatalogFetcher(async () => new Response('too many requests', { status: 429 })),
      repository: 'agirunner/agirunner-playbooks',
      ref: 'main',
      rawBaseUrl: 'https://raw.example.test',
    });

    await expect(service.listPlaybooks()).rejects.toMatchObject({
      message: 'Failed to fetch catalog/playbooks.yaml: HTTP 429',
      statusCode: 429,
    });
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
