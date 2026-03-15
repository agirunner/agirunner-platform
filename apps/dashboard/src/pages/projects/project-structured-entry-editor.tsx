import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  createStructuredEntryDraft,
  type StructuredEntryDraft,
  type StructuredValueType,
} from './project-detail-support.js';
import { cn } from '../../lib/utils.js';

export function StructuredEntryEditor(props: {
  title: string;
  description?: string;
  drafts: StructuredEntryDraft[];
  onChange(drafts: StructuredEntryDraft[]): void;
  addLabel: string;
  allowedTypes?: StructuredValueType[];
  stringInputMode?: 'single-line' | 'multiline';
  pageSize?: number;
}): JSX.Element {
  const allowedTypes = props.allowedTypes ?? ['string', 'number', 'boolean', 'json'];
  const showTypeSelector = allowedTypes.length > 1;
  const labelClassName = 'text-xs font-medium text-muted sm:w-10 sm:shrink-0';
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = props.pageSize ? Math.max(1, Math.ceil(props.drafts.length / props.pageSize)) : 1;
  const startIndex = props.pageSize ? (currentPage - 1) * props.pageSize : 0;
  const endIndex = props.pageSize ? startIndex + props.pageSize : props.drafts.length;
  const visibleDrafts = props.pageSize ? props.drafts.slice(startIndex, endIndex) : props.drafts;

  useEffect(() => {
    setCurrentPage((existingPage) => Math.min(existingPage, totalPages));
  }, [totalPages]);

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">{props.title}</div>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </div>
      {props.drafts.length === 0 ? (
        <p className="text-sm text-muted">No entries added yet.</p>
      ) : (
        visibleDrafts.map((draft) => (
          <div key={draft.id} className="grid gap-3 rounded-md border border-border p-3">
            <div
              className={
                showTypeSelector
                  ? 'grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_10rem_auto] sm:items-center'
                  : 'grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center'
              }
            >
              <span className={labelClassName}>Key</span>
              <div className="min-w-0">
                <Input
                  className="w-full"
                  value={draft.key}
                  onChange={(event) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { key: event.target.value }))
                  }
                />
              </div>
              {showTypeSelector ? (
                <>
                  <span className={labelClassName}>Type</span>
                  <Select
                    value={draft.valueType}
                    onValueChange={(value) =>
                      props.onChange(
                        updateStructuredDraft(props.drafts, draft.id, {
                          valueType: value as StructuredValueType,
                        }),
                      )
                    }
                  >
                    <SelectTrigger className="w-full min-w-0 sm:w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatStructuredTypeLabel(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full whitespace-nowrap sm:w-auto sm:justify-self-end"
                onClick={() => props.onChange(props.drafts.filter((entry) => entry.id !== draft.id))}
              >
                <Trash2 className="h-4 w-4" />
                Remove entry
              </Button>
            </div>
            <div className='grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:items-start'>
              <span className={cn(labelClassName, props.stringInputMode === 'single-line' ? 'pt-2 sm:pt-2' : 'pt-2')}>
                Value
              </span>
              <div className="min-w-0">
                <StructuredValueInput
                  valueType={draft.valueType}
                  value={draft.value}
                  stringInputMode={props.stringInputMode ?? 'single-line'}
                  onChange={(value) =>
                    props.onChange(updateStructuredDraft(props.drafts, draft.id, { value }))
                  }
                />
              </div>
            </div>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const nextDrafts = [
            ...props.drafts,
            createStructuredEntryDraft(allowedTypes[0] ?? 'string'),
          ];
          props.onChange(nextDrafts);
          if (props.pageSize) {
            setCurrentPage(Math.max(1, Math.ceil(nextDrafts.length / props.pageSize)));
          }
        }}
      >
        <Plus className="h-4 w-4" />
        {props.addLabel}
      </Button>
      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <p className="text-xs text-muted">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous page
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              Next page
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StructuredValueInput(props: {
  valueType: StructuredValueType;
  value: string;
  stringInputMode: 'single-line' | 'multiline';
  onChange(value: string): void;
}): JSX.Element {
  if (props.valueType === 'boolean') {
    return (
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select boolean value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Unset</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (props.valueType === 'json') {
    return (
      <Textarea
        value={props.value}
        className="min-h-[100px] font-mono text-xs"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  if (props.stringInputMode === 'multiline') {
    return (
      <Textarea
        value={props.value}
        className="min-h-[100px]"
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      type={props.valueType === 'number' ? 'number' : 'text'}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function formatStructuredTypeLabel(value: StructuredValueType): string {
  switch (value) {
    case 'json':
      return 'JSON';
    case 'number':
      return 'Number';
    case 'boolean':
      return 'Boolean';
    default:
      return 'String';
  }
}

function updateStructuredDraft(
  drafts: StructuredEntryDraft[],
  draftId: string,
  patch: Partial<StructuredEntryDraft>,
): StructuredEntryDraft[] {
  return drafts.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft));
}
