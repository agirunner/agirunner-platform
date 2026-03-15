import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './toggle-card.tsx'), 'utf8');
}

describe('toggle card source', () => {
  it('supports clickable active-state cards instead of a dead status label', () => {
    const source = readSource();

    expect(source).toContain("checkedLabel?: string;");
    expect(source).toContain("uncheckedLabel?: string;");
    expect(source).toContain("role=\"button\"");
    expect(source).toContain("tabIndex={props.disabled ? -1 : 0}");
    expect(source).toContain("onClick={() => {");
    expect(source).toContain('props.onCheckedChange(!props.checked);');
    expect(source).toContain("onKeyDown={(event) => {");
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain("onClick={(event) => event.stopPropagation()}");
    expect(source).toContain("props.checked ? (props.checkedLabel ?? 'Enabled') : (props.uncheckedLabel ?? 'Disabled')");
  });
});
