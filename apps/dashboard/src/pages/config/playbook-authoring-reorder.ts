export type DraftReorderDirection = 'earlier' | 'later';

export function canMoveDraftItem(
  index: number,
  total: number,
  direction: DraftReorderDirection,
): boolean {
  if (index < 0 || total <= 0 || index >= total) {
    return false;
  }
  if (direction === 'earlier') {
    return index > 0;
  }
  return index < total - 1;
}

export function moveDraftItem<T>(
  items: readonly T[],
  index: number,
  direction: DraftReorderDirection,
): T[] {
  if (!canMoveDraftItem(index, items.length, direction)) {
    return [...items];
  }
  const next = [...items];
  const targetIndex = direction === 'earlier' ? index - 1 : index + 1;
  const [item] = next.splice(index, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

export function spliceDraftItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
