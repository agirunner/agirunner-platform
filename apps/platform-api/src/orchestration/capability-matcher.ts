export function isCapabilitySubset(required: string[], offered: string[]): boolean {
  const offeredSet = new Set(offered.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return required.map((item) => item.trim().toLowerCase()).filter(Boolean).every((item) => offeredSet.has(item));
}

/**
 * FR-752 — Built-in agent replaceable by external agent.
 * FR-756 — Built-in agents have no exclusive capabilities.
 *
 * Returns `true` when at least one external (non-built-in) candidate covers
 * every capability that the built-in agent offers.  The built-in agent and the
 * external candidate use the identical capability system — no special
 * privileges exist on the built-in side.
 *
 * A built-in agent is considered replaceable when:
 *   1. An external agent's capability set is a superset of (or equal to) the
 *      built-in agent's advertised capabilities.
 *   2. The external agent is currently active/idle (not offline or draining).
 *
 * @param builtInCapabilities - Capabilities of the built-in agent to replace.
 * @param externalCandidates  - Pool of external agents / workers to check.
 * @returns true if at least one external candidate can replace the built-in agent.
 */
export function isBuiltInAgentReplaceable(
  builtInCapabilities: string[],
  externalCandidates: ReadonlyArray<{
    capabilities: string[];
    status: string;
    isBuiltIn: boolean;
  }>,
): boolean {
  return externalCandidates.some(
    (candidate) =>
      !candidate.isBuiltIn &&
      candidate.status !== 'offline' &&
      candidate.status !== 'draining' &&
      isCapabilitySubset(builtInCapabilities, candidate.capabilities),
  );
}

const priorityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export function compareClaimPriority(
  left: { priority: string; createdAt: Date },
  right: { priority: string; createdAt: Date },
): number {
  const rankDiff = (priorityRank[right.priority] ?? 0) - (priorityRank[left.priority] ?? 0);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  return left.createdAt.getTime() - right.createdAt.getTime();
}
