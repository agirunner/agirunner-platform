import { LayoutGrid, List } from 'lucide-react';

import { Button } from '../../components/ui/button.js';

import type { ViewMode } from './workflow-list-support.js';

export function WorkflowListViewToggle(props: {
  value: ViewMode;
  onChange(value: ViewMode): void;
}): JSX.Element {
  return (
    <div
      className="grid w-full gap-1 rounded-lg border border-border/70 bg-background/80 p-1 sm:w-auto sm:grid-cols-2"
      role="group"
      aria-label="Board layout mode"
    >
      <Button
        variant={props.value === 'list' ? 'secondary' : 'ghost'}
        size="sm"
        className="justify-start sm:justify-center"
        aria-pressed={props.value === 'list'}
        onClick={() => props.onChange('list')}
      >
        <List className="h-4 w-4" />
        List view
      </Button>
      <Button
        variant={props.value === 'board' ? 'secondary' : 'ghost'}
        size="sm"
        className="justify-start sm:justify-center"
        aria-pressed={props.value === 'board'}
        onClick={() => props.onChange('board')}
      >
        <LayoutGrid className="h-4 w-4" />
        Board view
      </Button>
    </div>
  );
}
