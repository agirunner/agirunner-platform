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
