import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './playbook-authoring-form-sections.tsx',
    './playbook-authoring-structured-controls.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('playbook authoring form sections source', () => {
  it('uses structured controls for known stage and parameter choices and exposes explicit reordering controls', () => {
    const source = readSource();
    expect(source).toContain('validateBoardColumnsDraft');
    expect(source).toContain('MultiChoiceButtonsControl');
    expect(source).toContain('SelectWithCustomControl');
    expect(source).toContain('TypedParameterValueControl');
    expect(source).toContain('moveDraftItem');
    expect(source).toContain('Move Earlier');
    expect(source).toContain('Move Later');
    expect(source).toContain('Remove Role');
    expect(source).toContain('className="min-w-0 flex-1"');
    expect(source).toContain('className="shrink-0 whitespace-nowrap px-3"');
    expect(source).toContain('Resolve board-column blockers before save.');
    expect(source).toContain(
      'Use a stable slug-style ID. This is what automation, stages, and board links reference.',
    );
    expect(source).toContain(
      'Labels should match the board language operators use in workflow views.',
    );
    expect(source).toContain('Default intake column');
    expect(source).toContain(
      'Automation and manual intake land here unless a work item explicitly targets',
    );
    expect(source).toContain('another column.');
    expect(source).toContain('Blocked columns signal stalled work that needs intervention.');
    expect(source).toContain('Terminal columns mark end-state lanes such as done or cancelled.');
    expect(source).toContain('Column ${index + 1} of ${columnCount}');
    expect(source).toContain('Stage ${index + 1} of ${stageCount}');
    expect(source).toContain('Add team roles above to make them selectable here.');
    expect(source).toContain('Playbooks use active role definitions from the shared role catalog.');
    expect(source).toContain('project.repository_url');
    expect(source).toContain('project.settings.default_branch');
    expect(source).toContain('project.credentials.git_token');
    expect(source).toContain('Structured object fields');
    expect(source).toContain('Structured list items');
    expect(source).toContain('Add object field');
    expect(source).toContain('Add list item');
    expect(source).toContain('Resolve parameter mapping blockers before save.');
    expect(source).toContain(
      'Use categories only when mapping repository metadata or secure',
    );
    expect(source).toContain('Secret parameters can only map to secret-backed project values.');
    expect(source).toContain('Repository parameters should map to non-secret project metadata.');
    expect(source).toContain('project.settings.knowledge.<key>');
    expect(source).toContain('Operator description');
    expect(source).toContain('Launch label');
    expect(source).toContain('Human-readable label shown to operators at launch time.');
    expect(source).toContain('Help text');
    expect(source).toContain('Contextual guidance displayed below the input field for operators.');
    expect(source).toContain('Allowed values');
    expect(source).toContain('Comma-separated list of accepted values. Leave empty for free-form input.');
    expect(source).toContain(
      'Shown to operators at launch. Use stage guidance or orchestrator instructions',
    );
    expect(source).toContain('Category stays hidden until this parameter maps to project data');
    expect(source).toContain('Cap how many full rework loops the orchestrator can request');
    expect(source).toContain('Limits specialist fan-out for one work item');
    expect(source).toContain('In an SDLC workflow, a value of 2 lets one feature run');
    expect(source).toContain('implementation and QA in parallel while preserving capacity');
    expect(source).toContain('spliceDraftItem');
    expect(source).toContain('GripVertical');
    expect(source).toContain('Drag to reorder');
    expect(source).toContain('drag handle');
    expect(source).toContain('Specialist runtime override');
    expect(source).toContain('Most playbooks should inherit tenant runtime defaults.');
    expect(source).not.toContain('Custom role');
    expect(source).not.toContain('Optional verification tools');
    expect(source).not.toContain('toggleOrchestratorTool');
    expect(source).not.toContain('Shared runtime defaults');
    expect(source).not.toContain('Orchestrator pool override');
    expect(source).not.toContain('Pull policy');
    expect(source).not.toContain('Input style');
    expect(source).not.toContain('PARAMETER_INPUT_STYLE_OPTIONS');
    expect(source).not.toContain('type="checkbox"');
  });
});
