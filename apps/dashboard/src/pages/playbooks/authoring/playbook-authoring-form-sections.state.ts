import {
  normalizeParameterSlug,
  type BoardColumnDraft,
  type ParameterDraft,
  type PlaybookAuthoringDraft,
  type StageDraft,
} from './playbook-authoring-support.js';
import { canMoveDraftItem, moveDraftItem } from './playbook-authoring-reorder.js';
import {
  ENTRY_COLUMN_UNSET,
  ROLE_SELECT_UNSET,
  type SectionProps,
} from './playbook-authoring-form-sections.shared.js';

export function moveHandler(
  props: SectionProps,
  key: 'stages' | 'columns' | 'parameters',
  index: number,
  direction: 'earlier' | 'later',
): (() => void) | undefined {
  const values =
    key === 'stages'
      ? props.draft.stages
      : key === 'columns'
        ? props.draft.columns
        : props.draft.parameters;
  if (!canMoveDraftItem(index, values.length, direction)) {
    return undefined;
  }
  if (key === 'stages') {
    return () =>
      props.onChange((current) => ({
        ...current,
        stages: moveDraftItem(current.stages, index, direction),
      }));
  }
  if (key === 'columns') {
    return () =>
      props.onChange((current) => ({
        ...current,
        columns: moveDraftItem(current.columns, index, direction),
      }));
  }
  return () =>
    props.onChange((current) => ({
      ...current,
      parameters: moveDraftItem(current.parameters, index, direction),
    }));
}

export function updateStage(
  props: SectionProps,
  index: number,
  field: keyof StageDraft,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    stages: current.stages.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

export function updateColumn(
  props: SectionProps,
  index: number,
  field: keyof Omit<BoardColumnDraft, 'is_blocked' | 'is_terminal'>,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    entry_column_id:
      field === 'id' && current.columns[index]?.id.trim() === current.entry_column_id.trim()
        ? value.trim()
        : current.entry_column_id,
    columns: current.columns.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

export function updateEntryColumnSelection(props: SectionProps, value: string): void {
  props.onChange((current) => ({
    ...current,
    entry_column_id: resolveSelectedColumnId(current.columns, value),
  }));
}

export function updateSemanticColumnSelection(
  props: SectionProps,
  field: 'is_blocked' | 'is_terminal',
  value: string,
): void {
  const selectedIndex = parseSelectedColumnIndex(value);
  props.onChange((current) => ({
    ...current,
    columns: current.columns.map((entry, entryIndex) => ({
      ...entry,
      [field]: selectedIndex !== null && entryIndex === selectedIndex,
    })),
  }));
}

export function updateOrchestrator(
  props: SectionProps,
  field: keyof PlaybookAuthoringDraft['orchestrator'],
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    orchestrator: { ...current.orchestrator, [field]: value },
  }));
}

export function updateParameter(
  props: SectionProps,
  index: number,
  field: keyof Omit<ParameterDraft, 'required'>,
  value: string,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

export function updateParameterTitle(props: SectionProps, index: number, value: string): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) => {
      if (entryIndex !== index) {
        return entry;
      }

      const nextSlug = normalizeParameterSlug(value);
      const currentSlug = entry.slug.trim();
      const priorTitleSlug = normalizeParameterSlug(entry.title);
      return {
        ...entry,
        title: value,
        slug: !currentSlug || currentSlug === priorTitleSlug ? nextSlug : entry.slug,
      };
    }),
  }));
}

export function updateParameterBoolean(
  props: SectionProps,
  index: number,
  field: 'required',
  value: boolean,
): void {
  props.onChange((current) => ({
    ...current,
    parameters: current.parameters.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry,
    ),
  }));
}

export function resolveRoleSelectionValue(
  value: string,
  availableRoleNames: string[],
  index: number,
): string {
  return availableRoleNames.includes(value)
    ? value
    : value.trim()
      ? resolveMissingRoleValue(index)
      : ROLE_SELECT_UNSET;
}

export function resolveMissingRoleValue(index: number): string {
  return `__missing_role_${index}__`;
}

export function buildBoardColumnSelectOptions(
  columns: BoardColumnDraft[],
): Array<{ value: string; label: string }> {
  return columns
    .map((column, index) => {
      const id = column.id.trim();
      if (!id) {
        return null;
      }
      const label = column.label.trim();
      return {
        value: String(index),
        label: label && label !== id ? `${label} (${id})` : label || id,
      };
    })
    .filter((option): option is { value: string; label: string } => option !== null);
}

export function resolveEntryColumnSelectionValue(
  columns: BoardColumnDraft[],
  entryColumnId: string,
): string {
  const selectedIndex = columns.findIndex((column) => column.id.trim() === entryColumnId.trim());
  return selectedIndex >= 0 ? String(selectedIndex) : ENTRY_COLUMN_UNSET;
}

export function resolveSemanticColumnSelectionValue(
  columns: BoardColumnDraft[],
  field: 'is_blocked' | 'is_terminal',
): string {
  const selectedIndex = columns.findIndex((column) => column.id.trim() && column[field]);
  return selectedIndex >= 0 ? String(selectedIndex) : ENTRY_COLUMN_UNSET;
}

function resolveSelectedColumnId(columns: BoardColumnDraft[], value: string): string {
  const selectedIndex = parseSelectedColumnIndex(value);
  if (selectedIndex === null) {
    return '';
  }
  return columns[selectedIndex]?.id.trim() ?? '';
}

function parseSelectedColumnIndex(value: string): number | null {
  if (value === ENTRY_COLUMN_UNSET) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
