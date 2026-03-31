export interface ComboboxItem {
  id: string;
  label: string;
  subtitle?: string;
  status?: 'active' | 'completed' | 'failed' | 'pending';
}

export interface ComboboxGroup {
  label: string;
  items: ComboboxItem[];
}

export interface SearchableComboboxProps {
  items: ComboboxItem[];
  recentItems?: ComboboxItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allGroupLabel?: string;
  onSearch?: (query: string) => void;
  isLoading?: boolean;
  className?: string;
  disabled?: boolean;
  multiSelect?: boolean;
  selectedIds?: Set<string>;
  onClearAll?: () => void;
}

export const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500',
  completed: 'bg-blue-500',
  failed: 'bg-red-500',
  pending: 'bg-yellow-500',
};

export const ITEM_HEIGHT_PX = 48;
export const GROUP_HEADER_HEIGHT_PX = 28;
export const MAX_LIST_HEIGHT_PX = 384;
export const VIRTUALIZE_AFTER_ROW_COUNT = 24;

export type FlatRow =
  | { type: 'header'; label: string }
  | { type: 'item'; item: ComboboxItem; flatIndex: number };

export type ItemRow = Extract<FlatRow, { type: 'item' }>;

export function buildFlatRows(
  recentItems: ComboboxItem[],
  allItems: ComboboxItem[],
  allGroupLabel: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  let flatIndex = 0;

  if (recentItems.length > 0) {
    rows.push({ type: 'header', label: 'Recent' });
    for (const item of recentItems) {
      rows.push({ type: 'item', item, flatIndex });
      flatIndex += 1;
    }
  }

  if (allItems.length > 0) {
    rows.push({ type: 'header', label: allGroupLabel });
    for (const item of allItems) {
      rows.push({ type: 'item', item, flatIndex });
      flatIndex += 1;
    }
  }

  return rows;
}

export function collectSelectableItems(rows: FlatRow[]): ComboboxItem[] {
  return rows.filter(isItemRow).map((row) => row.item);
}

export function isItemRow(row: FlatRow): row is ItemRow {
  return row.type === 'item';
}
