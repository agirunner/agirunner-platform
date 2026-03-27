export function formatUsdDisplay(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatCountLabel(
  count: number,
  singularLabel: string,
  emptyLabel: string,
): string {
  if (count <= 0) {
    return emptyLabel;
  }
  return `${count} ${singularLabel}${count === 1 ? '' : 's'}`;
}

export function formatKeyPreview(
  values: string[],
  emptyLabel: string,
  limit = 3,
): string {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return emptyLabel;
  }

  const visible = normalized.slice(0, limit);
  const hiddenCount = normalized.length - visible.length;
  return hiddenCount > 0
    ? `${visible.join(', ')} +${hiddenCount} more`
    : visible.join(', ');
}
