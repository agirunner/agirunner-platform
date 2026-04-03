import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PLAYBOOKS_YAML = `playbooks:
  - id: fixture-bug-fix
    name: Fixture Bug Fix
    author: agirunner
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Diagnose and fix a bounded defect in the self-contained catalog fixture.
    specialist_ids:
      - fixture-developer
    path: playbooks/engineering/fixture-bug-fix/playbook.yaml
  - id: fixture-follow-up
    name: Fixture Follow Up
    author: agirunner
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Continue a bounded fix using the same specialist contract.
    specialist_ids:
      - fixture-developer
    path: playbooks/engineering/fixture-follow-up/playbook.yaml
  - id: fixture-regression-sweep
    name: Fixture Regression Sweep
    author: agirunner
    category: engineering
    stability: experimental
    version: 1.0.0
    summary: Verify a bounded fix and record regression evidence.
    specialist_ids:
      - fixture-developer
    path: playbooks/engineering/fixture-regression-sweep/playbook.yaml
`;

const SPECIALISTS_YAML = `specialists:
  - id: fixture-developer
    name: Fixture Software Developer
    category: engineering
    stability: experimental
    summary: Implements scoped changes and records verification evidence.
    skill_ids:
      - fixture-bug-reproduction
    path: specialists/engineering/fixture-developer/specialist.yaml
`;

const SKILLS_YAML = `skills:
  - id: fixture-bug-reproduction
    name: Fixture Bug Reproduction
    category: engineering
    stability: experimental
    summary: Bound the defect before implementation.
    path: skills/engineering/fixture-bug-reproduction/SKILL.md
`;

const TOOL_PROFILES_YAML = `tool_profiles:
  - id: all-specialist-tools
    description: Enables the default specialist tool set.
    tools:
      - file_read
      - shell_exec
      - submit_handoff
`;

const SPECIALIST_YAML = `id: fixture-developer
name: Fixture Software Developer
category: engineering
stability: experimental
description: Implements scoped code or configuration changes and records verification evidence.
allowed_tools: all-specialist-tools
skill_ids:
  - fixture-bug-reproduction
system_prompt: |
  You are the Fixture Software Developer.
`;

const SKILL_MD = `---
name: fixture-bug-reproduction
description: Use when a defect must be reproduced or tightly bounded before implementation.
---

# Fixture Bug Reproduction

## Purpose
Bound a defect before changing code.
`;

const PLAYBOOK_FIXTURES = [
  {
    slug: 'fixture-bug-fix',
    name: 'Fixture Bug Fix',
    description: 'Diagnose and fix a bounded defect in the fixture workspace.',
    outcome: 'A bounded defect is fixed with explicit verification evidence.',
    stageName: 'reproduce',
    stageGoal: 'The defect is bounded with concrete evidence.',
    readme: '# Fixture Bug Fix\n\nUse this fixture playbook when a bounded defect needs reproduction and implementation.\n',
  },
  {
    slug: 'fixture-follow-up',
    name: 'Fixture Follow Up',
    description: 'Continue an existing fix after initial triage is complete.',
    outcome: 'The bounded defect progresses with explicit implementation evidence.',
    stageName: 'implement',
    stageGoal: 'The bounded fix is implemented.',
    readme: '# Fixture Follow Up\n\nUse this fixture playbook when follow-up implementation work is needed.\n',
  },
  {
    slug: 'fixture-regression-sweep',
    name: 'Fixture Regression Sweep',
    description: 'Verify a bounded fix and record the regression outcome.',
    outcome: 'Regression risk is assessed and the supported outcome is recorded.',
    stageName: 'verify',
    stageGoal: 'The fix is verified against regression risk.',
    readme: '# Fixture Regression Sweep\n\nUse this fixture playbook to verify a bounded fix and capture evidence.\n',
  },
] as const;

export interface CommunityCatalogFixtureRoot {
  path: string;
  cleanup(): Promise<void>;
}

export async function createCommunityCatalogFixtureRoot(): Promise<CommunityCatalogFixtureRoot> {
  const root = await mkdtemp(join(tmpdir(), 'community-catalog-fixture-'));
  await writeCatalogFile(root, 'catalog/playbooks.yaml', PLAYBOOKS_YAML);
  await writeCatalogFile(root, 'catalog/specialists.yaml', SPECIALISTS_YAML);
  await writeCatalogFile(root, 'catalog/skills.yaml', SKILLS_YAML);
  await writeCatalogFile(root, 'catalog/tool-profiles.yaml', TOOL_PROFILES_YAML);
  await writeCatalogFile(root, 'specialists/engineering/fixture-developer/specialist.yaml', SPECIALIST_YAML);
  await writeCatalogFile(root, 'skills/engineering/fixture-bug-reproduction/SKILL.md', SKILL_MD);

  for (const playbook of PLAYBOOK_FIXTURES) {
    await writeCatalogFile(
      root,
      `playbooks/engineering/${playbook.slug}/playbook.yaml`,
      renderPlaybookYaml(playbook),
    );
    await writeCatalogFile(
      root,
      `playbooks/engineering/${playbook.slug}/README.md`,
      playbook.readme,
    );
  }

  return {
    path: root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

function renderPlaybookYaml(input: (typeof PLAYBOOK_FIXTURES)[number]): string {
  return `id: ${input.slug}
version: 1.0.0
name: ${input.name}
author: agirunner
slug: ${input.slug}
category: engineering
stability: experimental
description: ${input.description}
outcome: ${input.outcome}
lifecycle: planned
specialist_ids:
  - fixture-developer
definition:
  outcome: ${input.outcome}
  process_instructions: |
    Preferred flow: reproduce, implement, verify, and close with explicit evidence.
  parameters:
    - slug: issue_summary
      title: Issue Summary
      required: true
  roles:
    - Fixture Software Developer
  board:
    entry_column_id: planned
    columns:
      - id: planned
        label: Planned
  stages:
    - name: ${input.stageName}
      goal: ${input.stageGoal}
      involves:
        - Fixture Software Developer
  lifecycle: planned
`;
}

async function writeCatalogFile(root: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf8');
}
