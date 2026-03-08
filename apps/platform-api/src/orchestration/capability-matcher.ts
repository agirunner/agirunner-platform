export function isCapabilitySubset(required: string[], offered: string[]): boolean {
  const offeredSet = new Set(offered.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return required.map((item) => item.trim().toLowerCase()).filter(Boolean).every((item) => offeredSet.has(item));
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
