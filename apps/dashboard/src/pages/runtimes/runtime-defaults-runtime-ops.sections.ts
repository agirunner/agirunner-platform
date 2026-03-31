import type { SectionDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    key: 'runtime_throughput',
    title: 'Agent throughput',
    description: 'Set local queue buffering limits for a specialist agent process.',
  },
  {
    key: 'server_timeouts',
    title: 'Agent Transport & Timeouts',
    description:
      'Bound local HTTP handling plus agent API heartbeats and upstream model request timeouts.',
  },
  {
    key: 'runtime_api',
    title: 'Agent API',
    description: 'Control task-event heartbeat cadence for active agent API streams.',
  },
  {
    key: 'llm_transport',
    title: 'LLM transport',
    description:
      'Control upstream model transport deadlines used by specialist agent provider adapters.',
  },
  {
    key: 'tool_timeouts',
    title: 'Tool Execution Timeouts',
    description: 'Set execution ceilings for the built-in file, git, shell, web, and MCP tools.',
  },
  {
    key: 'lifecycle_timeouts',
    title: 'Health Checks & Shutdown',
    description: 'Control health checks plus stop and destroy deadlines for specialist executions.',
  },
  {
    key: 'task_timeouts',
    title: 'Workflow Timing',
    description:
      'Set the default task timeout plus activation, heartbeat, stale, and cancellation timing.',
  },
  {
    key: 'connected_platform',
    title: 'Platform Attachment',
    description:
      'Tune claim polling and connection behavior when specialist agents attach to the platform fleet.',
  },
  {
    key: 'realtime_transport',
    title: 'Realtime transport',
    description:
      'Tune event-stream keepalives and agent websocket reconnect cadence for realtime platform connections.',
  },
  {
    key: 'workflow_activation',
    title: 'Workflow activation',
    description:
      'Control activation debounce, heartbeat wakeups, stale detection, and task-cancel grace timing.',
  },
  {
    key: 'container_manager',
    title: 'Specialist Worker Containers',
    description:
      'Control specialist agent container reconcile, shutdown, and log-management behavior.',
  },
  {
    key: 'worker_supervision',
    title: 'Heartbeats & API Keys',
    description:
      'Tune heartbeats, dispatch acknowledgement, and API key lifetimes for specialist and standalone agents.',
  },
  {
    key: 'agent_supervision',
    title: 'Agent supervision',
    description:
      'Tune standalone agent heartbeat defaults, stale-task grace periods, and issued agent key lifetimes.',
  },
  {
    key: 'platform_loops',
    title: 'Background Sweeps & Dispatch',
    description:
      'Control the cadence of background platform enforcement, dispatch, pruning, and retention sweeps.',
  },
  {
    key: 'workspace_timeouts',
    title: 'Workspace Setup & Snapshots',
    description:
      'Bound workspace bootstrap steps and control clone retries and automatic snapshot cadence.',
  },
  {
    key: 'workspace_operations',
    title: 'Workspace operations',
    description: 'Control clone retries, backoff timing, and automatic workspace snapshot cadence.',
  },
  {
    key: 'capture_timeouts',
    title: 'Result Capture & Publishing',
    description:
      'Control how aggressively the specialist agent retries result publication and how long capture-side steps may run.',
  },
  {
    key: 'secrets_timeouts',
    title: 'Secret Provider Access',
    description: 'Limit secret-provider calls made by the specialist agent during task execution.',
  },
  {
    key: 'subagent_timeouts',
    title: 'Subagent Limits',
    description:
      'Set default timeout and fanout limits for delegated subagents spawned from a parent task.',
  },
];
