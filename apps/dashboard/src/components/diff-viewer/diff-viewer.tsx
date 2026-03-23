import { useCallback, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils.js';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const lcsMatrix = buildLcsMatrix(oldLines, newLines);
  return traceback(lcsMatrix, oldLines, newLines);
}

function buildLcsMatrix(oldLines: string[], newLines: string[]): number[][] {
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}

function traceback(
  matrix: number[][],
  oldLines: string[],
  newLines: string[],
): DiffLine[] {
  const result: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  let oldNum = oldLines.length;
  let newNum = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({
        type: 'unchanged',
        oldLineNumber: i,
        newLineNumber: j,
        content: oldLines[i - 1],
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      result.push({
        type: 'added',
        oldLineNumber: null,
        newLineNumber: j,
        content: newLines[j - 1],
      });
      j--;
    } else {
      result.push({
        type: 'removed',
        oldLineNumber: i,
        newLineNumber: null,
        content: oldLines[i - 1],
      });
      i--;
    }
  }

  return result.reverse();
}

interface DiffViewerProps {
  oldText: string;
  newText: string;
  oldLabel?: string;
  newLabel?: string;
}

export function DiffViewer({
  oldText,
  newText,
  oldLabel = 'Previous',
  newLabel = 'Current',
}: DiffViewerProps): JSX.Element {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const isSyncing = useRef(false);

  const syncScroll = useCallback(
    (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
      if (!source || !target || isSyncing.current) return;
      isSyncing.current = true;
      target.scrollTop = source.scrollTop;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing.current = false;
      });
    },
    [],
  );

  useEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    if (!left || !right) return;

    const onLeftScroll = () => syncScroll(left, right);
    const onRightScroll = () => syncScroll(right, left);

    left.addEventListener('scroll', onLeftScroll);
    right.addEventListener('scroll', onRightScroll);

    return () => {
      left.removeEventListener('scroll', onLeftScroll);
      right.removeEventListener('scroll', onRightScroll);
    };
  }, [syncScroll]);

  const diffLines = computeDiff(oldText, newText);

  const leftLines = diffLines.filter((l) => l.type !== 'added');
  const rightLines = diffLines.filter((l) => l.type !== 'removed');

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-2 border-b border-border bg-surface text-xs font-medium text-muted">
        <div className="px-3 py-1.5">{oldLabel}</div>
        <div className="border-l border-border px-3 py-1.5">{newLabel}</div>
      </div>
      <div className="grid grid-cols-2">
        <div ref={leftRef} className="max-h-96 overflow-auto">
          {leftLines.map((line, idx) => (
            <DiffLineRow key={idx} line={line} side="left" />
          ))}
        </div>
        <div
          ref={rightRef}
          className="max-h-96 overflow-auto border-l border-border"
        >
          {rightLines.map((line, idx) => (
            <DiffLineRow key={idx} line={line} side="right" />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffLineRow({
  line,
  side,
}: {
  line: DiffLine;
  side: 'left' | 'right';
}): JSX.Element {
  const lineNumber =
    side === 'left' ? line.oldLineNumber : line.newLineNumber;

  return (
    <div
      className={cn(
        'flex font-mono text-xs leading-5',
        line.type === 'added' && 'bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300',
        line.type === 'removed' && 'bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300',
        line.type === 'unchanged' && 'text-muted-foreground',
      )}
    >
      <span className="w-10 flex-shrink-0 select-none px-2 text-right text-muted opacity-60">
        {lineNumber ?? ''}
      </span>
      <span className="w-4 flex-shrink-0 select-none text-center">
        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
      </span>
      <span className="flex-1 whitespace-pre pr-2">{line.content}</span>
    </div>
  );
}
