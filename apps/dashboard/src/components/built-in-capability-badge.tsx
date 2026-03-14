/**
 * Built-in Capability Badge — FR-751
 *
 * Renders a visual indicator in the task detail view showing whether the
 * built-in worker CAN or CANNOT handle a given task based on its required
 * capabilities.
 *
 * The built-in worker is limited to llm-api work (FR-750). Tasks that require
 * Docker, bare-metal execution, or other non-LLM capabilities cannot be handled
 * by the built-in worker and must be routed to an external agent.
 */

/** Capabilities the built-in worker supports. FR-750. */
const BUILT_IN_SUPPORTED_CAPABILITIES = new Set([
  'coding',
  'code-review',
  'architecture',
  'testing',
  'security-review',
  'documentation',
  'requirements',
  'research',
  'project-management',
  'data-analysis',
]);

/** Capabilities that are explicitly NOT supported by the built-in worker. FR-750. */
const BUILT_IN_PROHIBITED_CAPABILITIES = new Set([
  'docker-exec',
  'bare-metal-exec',
  'host-filesystem-write',
  'arbitrary-network',
  'gpu',
  'browser-automation',
]);

export type CapabilityClassification = 'can-handle' | 'cannot-handle' | 'unknown';

export interface CapabilityTask {
  capabilities_required?: unknown;
  capabilities?: unknown;
}

export interface CapabilityBadgeProps {
  task: CapabilityTask;
}

/**
 * Classifies whether the built-in worker can handle the task based on its
 * required capabilities.
 *
 * Returns:
 *   'can-handle'    — all required capabilities are within llm-api bounds.
 *   'cannot-handle' — at least one capability is prohibited or unsupported.
 *   'unknown'       — no capability information is available.
 */
export function classifyTaskCapability(task: CapabilityTask): CapabilityClassification {
  const rawCapabilities = task.capabilities_required ?? task.capabilities;

  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0) {
    return 'unknown';
  }

  const required = rawCapabilities.filter((c): c is string => typeof c === 'string');

  if (required.length === 0) {
    return 'unknown';
  }

  // If any required capability is explicitly prohibited, the built-in cannot handle it.
  const hasProhibited = required.some((cap) => BUILT_IN_PROHIBITED_CAPABILITIES.has(cap));
  if (hasProhibited) {
    return 'cannot-handle';
  }

  // If all required capabilities are within the supported set, built-in can handle it.
  const allSupported = required.every((cap) => BUILT_IN_SUPPORTED_CAPABILITIES.has(cap));
  if (allSupported) {
    return 'can-handle';
  }

  // Unknown or custom capabilities — cannot guarantee built-in support.
  return 'cannot-handle';
}

/**
 * React component that renders the capability boundary badge in task detail view.
 * FR-751: makes it explicit to operators whether a task will use the built-in worker.
 */
export function BuiltInCapabilityBadge({ task }: CapabilityBadgeProps): JSX.Element {
  const classification = classifyTaskCapability(task);

  if (classification === 'unknown') {
    return (
      <div
        className="capability-badge capability-badge--unknown"
        role="status"
        aria-label="Worker capability: unknown"
      >
        <span className="capability-badge__icon">❓</span>
        <span className="capability-badge__label">
          <strong>Worker capability: unknown</strong> — No required capabilities specified.
        </span>
      </div>
    );
  }

  if (classification === 'can-handle') {
    return (
      <div
        className="capability-badge capability-badge--supported"
        role="status"
        aria-label="Built-in worker can handle this task"
      >
        <span className="capability-badge__icon">✅</span>
        <span className="capability-badge__label">
          <strong>Built-in worker eligible</strong> — All required capabilities are within LLM API
          bounds. An external agent will be preferred if available (FR-753).
        </span>
      </div>
    );
  }

  // cannot-handle
  const prohibited = Array.isArray(task.capabilities_required)
    ? task.capabilities_required.filter(
        (c): c is string => typeof c === 'string' && BUILT_IN_PROHIBITED_CAPABILITIES.has(c),
      )
    : [];

  return (
    <div
      className="capability-badge capability-badge--unsupported"
      role="status"
      aria-label="Built-in worker cannot handle this task"
    >
      <span className="capability-badge__icon">🚫</span>
      <span className="capability-badge__label">
        <strong>Requires external agent</strong> — This task needs capabilities beyond LLM API:{' '}
        {prohibited.length > 0 ? prohibited.join(', ') : 'unsupported capability detected'}. The
        built-in worker cannot handle it.
      </span>
    </div>
  );
}
