import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('log viewer source', () => {
  it('wires the live stream indicator and SSE hook into the raw log table with a configurable default live state', () => {
    const source = readSource('./log-viewer.tsx');
    expect(source).toContain('defaultLive?: boolean;');
    expect(source).toContain('defaultLive = false');
    expect(source).toContain('const [isLive, setIsLive] = useState(defaultLive);');
    expect(source).toContain('useLogStream({');
    expect(source).toContain('LogStreamIndicator');
    expect(source).toContain('LIVE_ENTRY_LIMIT');
    expect(source).toContain('setLiveEntries((current) => {');
    expect(source).toContain("isLive && viewMode === 'flat'");
    expect(source).not.toContain('LogExportButton');
    expect(source).not.toContain('exportSlot={<LogExportButton');
  });
});
