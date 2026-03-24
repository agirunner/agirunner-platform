import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSettingsPageSource() {
  return readFileSync(resolve(import.meta.dirname, './settings-page.tsx'), 'utf8');
}

describe('settings page source', () => {
  it('loads the logging and retention settings on one page', () => {
    const source = readSettingsPageSource();

    expect(source).toContain("queryKey: ['governance-logging-config']");
    expect(source).toContain("queryKey: ['retention-policy']");
    expect(source).toContain('dashboardApi.getLoggingConfig()');
    expect(source).toContain('dashboardApi.getRetentionPolicy()');
    expect(source).toContain('Logging</h2>');
    expect(source).toContain('Retention</h2>');
  });

  it('saves retention changes from the settings page', () => {
    const source = readSettingsPageSource();

    expect(source).toContain('dashboardApi.updateRetentionPolicy');
    expect(source).toContain('task_archive_after_days');
    expect(source).toContain('task_delete_after_days');
    expect(source).toContain('execution_log_retention_days');
  });

  it('uses the runtimes-style shell with one top save action and section content below', () => {
    const source = readSettingsPageSource();

    expect(source).toContain('CardTitle className="text-2xl">Settings</CardTitle>');
    expect(source).toContain('flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between');
    expect(source).toContain('handleSubmit');
    expect(source).toContain('const isDirty =');
    expect(source).toContain('const isSaving =');
    expect(source).toContain('Logging</h2>');
    expect(source).toContain('Retention</h2>');
    expect(source).toContain('border-t border-border/70 pt-6');
    expect(source).not.toContain('CardFooter');
    expect(source).not.toContain('handleLoggingSubmit');
    expect(source).not.toContain('handleRetentionSubmit');
  });
});
