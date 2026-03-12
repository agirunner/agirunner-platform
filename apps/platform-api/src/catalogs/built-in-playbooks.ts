export interface BuiltInPlaybook {
  name: string;
  slug: string;
  description: string;
  outcome: string;
  lifecycle: 'standard' | 'continuous';
  definition: Record<string, unknown>;
}

export const PROJECT_PLANNING_PLAYBOOK_SLUG = 'project-planning-v2';

export const BUILT_IN_PLAYBOOKS: BuiltInPlaybook[] = [
  {
    name: 'Project Planning',
    slug: PROJECT_PLANNING_PLAYBOOK_SLUG,
    description: 'Planning workflow that turns a project brief into a scoped execution plan.',
    outcome: 'A prioritized execution plan with initial work items.',
    lifecycle: 'standard',
    definition: {
      parameters: [
        {
          name: 'project_name',
          type: 'string',
          required: true,
          category: 'input',
          description: 'Project name',
        },
        {
          name: 'project_brief',
          type: 'string',
          required: true,
          category: 'input',
          description: 'Project brief to analyze',
        },
        {
          name: 'project_id',
          type: 'string',
          required: true,
          category: 'input',
          description: 'Project identifier',
        },
      ],
      roles: ['product-manager', 'architect'],
      board: {
        columns: [
          { id: 'planned', label: 'Planned', description: 'Planning tasks that are queued.' },
          { id: 'active', label: 'In Progress', description: 'Planning work underway.' },
          { id: 'review', label: 'In Review', description: 'Plan under review.' },
          { id: 'done', label: 'Done', description: 'Planning work completed.', is_terminal: true },
        ],
      },
      stages: [
        {
          name: 'planning',
          goal: 'Generate an actionable plan and starting backlog from the brief',
          involves: ['product-manager', 'architect'],
        },
      ],
      lifecycle: 'standard',
      orchestrator: {
        check_interval: '5m',
        stale_threshold: '30m',
        max_rework_iterations: 2,
        max_active_tasks: 2,
        max_active_tasks_per_work_item: 1,
        allow_parallel_work_items: false,
      },
      runtime: {
        pool_mode: 'warm',
        max_runtimes: 1,
        priority: 1,
      },
    },
  },
  {
    name: 'Software Development Lifecycle',
    slug: 'sdlc-v2',
    description: 'Orchestrated SDLC workflow with work items, review loops, and human gates.',
    outcome: 'Production-ready software with tests and documentation.',
    lifecycle: 'standard',
    definition: {
      parameters: [
        {
          name: 'goal',
          type: 'string',
          required: true,
          category: 'input',
          description: 'What this workflow should accomplish',
        },
        {
          name: 'repo',
          type: 'string',
          category: 'repository',
          maps_to: 'project.repository_url',
          description: 'Git repository URL',
        },
        {
          name: 'branch',
          type: 'string',
          category: 'repository',
          maps_to: 'project.settings.default_branch',
          default: 'main',
          description: 'Branch to work against',
        },
      ],
      roles: ['product-manager', 'architect', 'developer', 'reviewer', 'qa'],
      board: {
        columns: [
          {
            id: 'planned',
            label: 'Planned',
            description: 'Work is defined but not yet assigned to a specialist.',
          },
          {
            id: 'active',
            label: 'In Progress',
            description: 'A specialist is actively working on this deliverable.',
          },
          {
            id: 'review',
            label: 'In Review',
            description: 'Primary work is complete and under review.',
          },
          {
            id: 'blocked',
            label: 'Blocked',
            description: 'The work item is blocked and needs intervention.',
            is_blocked: true,
          },
          {
            id: 'done',
            label: 'Done',
            description: 'The work item meets its acceptance criteria.',
            is_terminal: true,
          },
        ],
      },
      stages: [
        {
          name: 'requirements',
          goal: 'Approved requirements with testable acceptance criteria',
          involves: ['product-manager', 'architect', 'qa'],
          human_gate: true,
        },
        {
          name: 'design',
          goal: 'Approved system design with ADRs for key decisions',
          involves: ['architect', 'product-manager', 'reviewer'],
        },
        {
          name: 'implementation',
          goal: 'Working code with tests on a feature branch',
          involves: ['developer', 'reviewer'],
        },
        {
          name: 'verification',
          goal: 'QA signoff with test evidence',
          involves: ['qa', 'developer'],
          human_gate: true,
        },
      ],
      lifecycle: 'standard',
      orchestrator: {
        check_interval: '5m',
        stale_threshold: '30m',
        max_rework_iterations: 3,
        max_active_tasks: 6,
        max_active_tasks_per_work_item: 2,
        allow_parallel_work_items: true,
      },
      runtime: {
        pool_mode: 'warm',
        max_runtimes: 3,
        priority: 5,
      },
    },
  },
];
