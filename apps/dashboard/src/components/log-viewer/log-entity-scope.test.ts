import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string): string {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('log entity scope source', () => {
  it('loads entity scope options lazily while keeping option caches warm after the operator opens them', () => {
    const scopeSource = readSource('./log-entity-scope.tsx');
    const hooksSource = readSource('./hooks/use-cascading-entities.ts');

    expect(scopeSource).toContain('const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);');
    expect(scopeSource).toContain('const [isWorkflowMenuOpen, setIsWorkflowMenuOpen] = useState(false);');
    expect(scopeSource).toContain('const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);');
    expect(scopeSource).toContain('onOpenChange={setIsWorkspaceMenuOpen}');
    expect(scopeSource).toContain('onOpenChange={setIsWorkflowMenuOpen}');
    expect(scopeSource).toContain('onOpenChange={setIsTaskMenuOpen}');
    expect(hooksSource).toContain('isWorkspaceMenuOpen || Boolean(workspaceId)');
    expect(hooksSource).toContain('isWorkflowMenuOpen || Boolean(workflowId)');
    expect(hooksSource).toContain('isTaskMenuOpen || Boolean(taskId)');
    expect(hooksSource).toContain('refetchInterval: 10_000');
    expect(hooksSource).toContain('refetchIntervalInBackground: true');
    expect(hooksSource).toContain('refetchOnWindowFocus: true');
  });
});
