export interface BuiltInPlaybook {
  name: string;
  slug: string;
  description: string;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  definition: Record<string, unknown>;
}

export const PROJECT_PLANNING_PLAYBOOK_SLUG = 'project-planning-v2';

export const BUILT_IN_PLAYBOOKS: BuiltInPlaybook[] = [
  {
    name: 'Project Planning',
    slug: PROJECT_PLANNING_PLAYBOOK_SLUG,
    description: 'Planning workflow that turns a project brief into a scoped execution plan.',
    outcome: 'A prioritized execution plan with initial work items.',
    lifecycle: 'planned',
    definition: {
      process_instructions:
        'Product manager clarifies the brief and success criteria. Architect turns the brief into a scoped execution plan. Human approval is required before the plan is considered complete.',
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
        entry_column_id: 'planned',
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
          guidance:
            'Clarify the brief, define acceptance criteria, and produce an initial execution plan and starting backlog.',
        },
      ],
      checkpoints: [
        {
          name: 'planning',
          goal: 'An actionable execution plan and starting backlog exist for the project.',
          human_gate: true,
          entry_criteria: 'A project brief and project identity have been provided.',
        },
      ],
      review_rules: [
        {
          from_role: 'architect',
          reviewed_by: 'product-manager',
          required: true,
        },
      ],
      approval_rules: [
        {
          on: 'completion',
          approved_by: 'human',
          required: true,
        },
      ],
      handoff_rules: [
        {
          from_role: 'product-manager',
          to_role: 'architect',
          required: true,
        },
        {
          from_role: 'architect',
          to_role: 'product-manager',
          required: true,
        },
      ],
      lifecycle: 'planned',
      orchestrator: {
        check_interval: '5m',
        stale_threshold: '30m',
        max_rework_iterations: 5,
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
    lifecycle: 'planned',
    definition: {
      process_instructions:
        'Product manager clarifies the goal and acceptance criteria and resolves scope questions with humans when needed. Architect produces or reviews the technical design before implementation begins. Developer implements the change. Reviewer must review every developer-delivered code change, and rejected review returns to developer with concrete findings. QA validates after reviewer approval and records evidence. Product manager confirms the delivered outcome, release notes, and operator communication. Human approval is required before release and completion.',
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
        entry_column_id: 'planned',
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
          name: 'review',
          goal: 'Reviewer verdict with concrete findings or approval',
          involves: ['reviewer', 'developer'],
        },
        {
          name: 'verification',
          goal: 'QA signoff with test evidence',
          involves: ['qa', 'developer', 'product-manager'],
        },
        {
          name: 'release',
          goal: 'Operator-ready release package and final human approval',
          involves: ['product-manager', 'qa'],
          human_gate: true,
        },
      ],
      lifecycle: 'planned',
      checkpoints: [
        {
          name: 'requirements',
          goal: 'Approved requirements with testable acceptance criteria.',
          human_gate: true,
          entry_criteria: 'The workflow goal and initial context are available.',
        },
        {
          name: 'design',
          goal: 'A design exists for the implementation approach when needed.',
          human_gate: false,
          entry_criteria: 'Requirements are clear enough to shape implementation.',
        },
        {
          name: 'implementation',
          goal: 'Working code exists and is ready for formal review.',
          human_gate: false,
          entry_criteria: 'Requirements and any required design are available.',
        },
        {
          name: 'review',
          goal: 'A reviewer verdict exists for every developer-delivered change.',
          human_gate: false,
          entry_criteria: 'Implementation output and developer handoff are available.',
        },
        {
          name: 'verification',
          goal: 'QA validation and evidence are complete.',
          human_gate: false,
          entry_criteria: 'Required review is complete and approved.',
        },
        {
          name: 'release',
          goal: 'Release notes, residual risk, and human approval are complete.',
          human_gate: true,
          entry_criteria: 'Verification evidence and operator summary are ready.',
        },
      ],
      review_rules: [
        {
          from_role: 'developer',
          reviewed_by: 'reviewer',
          required: true,
          on_reject: {
            action: 'return_to_role',
            role: 'developer',
          },
        },
      ],
      approval_rules: [
        {
          on: 'checkpoint',
          checkpoint: 'requirements',
          approved_by: 'human',
          required: true,
        },
        {
          on: 'checkpoint',
          checkpoint: 'release',
          approved_by: 'human',
          required: true,
        },
      ],
      handoff_rules: [
        {
          from_role: 'product-manager',
          to_role: 'architect',
          required: true,
        },
        {
          from_role: 'architect',
          to_role: 'developer',
          required: true,
        },
        {
          from_role: 'developer',
          to_role: 'reviewer',
          required: true,
        },
        {
          from_role: 'reviewer',
          to_role: 'developer',
          required: false,
        },
        {
          from_role: 'reviewer',
          to_role: 'qa',
          required: true,
        },
        {
          from_role: 'qa',
          to_role: 'product-manager',
          required: false,
        },
      ],
      orchestrator: {
        check_interval: '5m',
        stale_threshold: '30m',
        max_rework_iterations: 5,
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
