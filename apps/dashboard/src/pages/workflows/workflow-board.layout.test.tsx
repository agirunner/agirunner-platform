import { describe, expect, it } from 'vitest';

import type { WorkflowTaskPreviewSummary } from './workflow-board-task-preview.js';
import {
  createBoard,
  createBoardWithRecentCompletion,
  createFourLaneBoard,
  createWideBoard,
  renderWorkflowBoard,
} from './workflow-board.test-support.js';

describe('WorkflowBoard layout', () => {
  it('wraps board controls on smaller screens instead of hiding them behind horizontal overflow', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('Workflow board');
    expect(html).toContain('All stages');
    expect(html).toContain('All lanes');
    expect(html).toContain('flex min-w-0 flex-wrap items-center gap-2 px-3 py-2.5');
    expect(html).toContain(
      'flex min-w-0 items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-3',
    );
    expect(html).toContain('min-h-0 flex-1 overflow-x-auto overflow-y-auto pb-1');
    expect(html).toContain(
      'flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden sm:min-h-[15rem] lg:min-h-0',
    );
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/90 p-2.5 shadow-sm');
    expect(html).not.toContain('visible items');
  });

  it('keeps stage context on work items and hides meaningless default priority badges', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('Intake Triage');
    expect(html).not.toContain('normal');
    expect(html).not.toContain('>Medium<');
    expect(html).not.toContain('visible items');
    expect(html).not.toContain('>1 visible<');
    expect(html).not.toContain('1 active • 0 completed');
  });

  it('keeps the two most recent completions visible while collapsing older overflow by default', () => {
    const html = renderWorkflowBoard({
      board: createBoardWithRecentCompletion(),
    });

    expect(html).toContain('Recent completions');
    expect(html).toContain('Completed packet 1');
    expect(html).toContain('Completed packet 2');
    expect(html.indexOf('Completed packet 1')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 2')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 3')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 4')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html).toContain('2 older hidden');
  });

  it('keeps the two newest done items pinned while older done items move into the recent completions bucket in all mode', () => {
    const html = renderWorkflowBoard({
      board: createBoardWithRecentCompletion(),
      boardMode: 'all',
    });

    expect(html).toContain('Recent completions');
    expect(html.indexOf('Completed packet 1')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 2')).toBeLessThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 3')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html.indexOf('Completed packet 4')).toBeGreaterThan(html.indexOf('Recent completions'));
    expect(html).toContain('2 older hidden');
  });

  it('renders empty-lane copy inline instead of as a centered pseudo-card', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('Nothing active here right now.');
    expect(html).toContain('px-1 pb-1 text-sm text-muted-foreground');
    expect(html).not.toContain('No active work items in this lane.');
  });

  it('omits the empty task shell when a work item has no task previews yet', () => {
    const board = createBoard();
    const html = renderWorkflowBoard({
      board: {
        ...board,
        work_items: board.work_items.map((workItem) =>
          workItem.id === 'work-item-1'
            ? {
                ...workItem,
                gate_status: 'awaiting_approval',
              }
            : workItem,
        ),
      },
      selectedWorkItemId: 'work-item-1',
      taskPreviewSummaries: new Map<string, WorkflowTaskPreviewSummary>([
        [
          'work-item-1',
          {
            tasks: [],
            hasActiveOrchestratorTask: false,
          },
        ],
      ]),
    });

    expect(html).toContain('Review incoming packet');
    expect(html).not.toContain('No task previews available yet.');
    expect(html).not.toContain('Task preview');
    expect(html).not.toContain('>Tasks<');
  });

  it('keeps sparse lanes content-sized instead of stretching them to the full board height', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('grid min-w-full gap-3 md:grid-cols-3 md:items-start');
    expect(html).toContain(
      'grid min-w-0 content-start gap-2.5 rounded-lg border border-border/60 bg-muted/5 p-2.5',
    );
    expect(html).not.toContain('grid min-h-full gap-3 md:grid-flow-col md:auto-cols-[minmax(17.5rem,1fr)]');
  });

  it('keeps the heading band accented while leaving board filters neutral and unfilled', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('border-b border-border/60 bg-muted/20 px-3 py-3');
    expect(html).toContain('border border-border bg-transparent !text-foreground');
    expect(html).not.toContain('bg-accent !text-accent-foreground');
  });

  it('fits the standard four-lane board into one desktop row before falling back to horizontal overflow', () => {
    const html = renderWorkflowBoard({
      board: createFourLaneBoard(),
    });

    expect(html).toContain('grid min-w-full gap-3 md:grid-cols-4 md:items-start');
    expect(html).not.toContain('md:grid-flow-col md:auto-cols-[minmax(18rem,1fr)]');
  });

  it('uses a shorter mobile board minimum so the lower workbench stays reachable on phone', () => {
    const html = renderWorkflowBoard();

    expect(html).toContain('min-h-[11rem]');
    expect(html).toContain('sm:min-h-[15rem]');
    expect(html).not.toContain('sm:min-h-[18rem]');
    expect(html).not.toContain('min-h-[13rem]');
  });

  it('keeps the terminal lane inside a horizontally scrollable board track so done items stay reachable on desktop', () => {
    const html = renderWorkflowBoard({
      board: createWideBoard(),
    });

    expect(html).toContain('overflow-x-auto overflow-y-auto');
    expect(html).toContain('scrollbar-width:thin');
    expect(html).toContain(
      'grid w-max min-w-full gap-3 md:grid-flow-col md:auto-cols-[minmax(16rem,1fr)] md:items-start',
    );
    expect(html).toContain('Terminal lane');
    expect(html).toContain('Completed packet 1');
  });
});
