import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-structured-entry-editor.tsx'), 'utf8');
}

describe('structured entry editor source', () => {
  it('keeps key, type, and remove controls on one compact row before the value field', () => {
    const source = readSource();

    expect(source).toContain("const labelClassName = 'text-xs font-medium text-muted sm:w-10 sm:shrink-0';");
    expect(source).toContain(
      "'grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_2.75rem_10rem_auto] sm:items-center'",
    );
    expect(source).toContain('<div className="min-w-0">');
    expect(source).toContain('className="w-full"');
    expect(source).toContain('className="w-full min-w-0 sm:w-full"');
    expect(source).toContain(
      'className="w-full whitespace-nowrap sm:w-auto sm:justify-self-end"',
    );
    expect(source).toContain("className='grid gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:items-start'");
    expect(source).toContain('className={cn(labelClassName, props.stringInputMode === \'single-line\' ? \'pt-2 sm:pt-2\' : \'pt-2\')}');
    expect(source).not.toContain('absolute top-3 right-3');
  });

  it('supports bounded paging for long draft lists instead of dumping every entry at once', () => {
    const source = readSource();

    expect(source).toContain('pageSize?: number;');
    expect(source).toContain('const [currentPage, setCurrentPage] = useState(1);');
    expect(source).toContain('const totalPages = props.pageSize ? Math.max(1, Math.ceil(props.drafts.length / props.pageSize)) : 1;');
    expect(source).toContain('const visibleDrafts = props.pageSize ? props.drafts.slice(startIndex, endIndex) : props.drafts;');
    expect(source).toContain('Previous page');
    expect(source).toContain('Next page');
  });
});
