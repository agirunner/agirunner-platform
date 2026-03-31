import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDown, Hammer, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import {
  describeBuildOutcome,
  describeExportOutcome,
  describeGatesSummary,
  describeLinkOutcome,
  describeValidationOutcome,
} from './runtimes-build-history.support.js';
import { RuntimeActionResult } from './runtimes-build-history.shared.js';

export function RuntimeManagementCard(): JSX.Element {
  const queryClient = useQueryClient();
  const [lastBuildId, setLastBuildId] = useState<string | null>(null);

  const validateMutation = useMutation({
    mutationFn: async () => {
      const inspect = await dashboardApi.reconstructCustomization();
      return dashboardApi.validateCustomization({ manifest: inspect.manifest });
    },
  });

  const buildMutation = useMutation({
    mutationFn: async () => {
      const inspect = await dashboardApi.reconstructCustomization();
      return dashboardApi.createCustomizationBuild({ manifest: inspect.manifest });
    },
    onSuccess: (result) => {
      if (result.build_id) {
        setLastBuildId(result.build_id);
      }
      void queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    },
  });

  const linkMutation = useMutation({
    mutationFn: (buildId: string) => dashboardApi.linkCustomizationBuild({ build_id: buildId }),
    onSuccess: () => {
      setLastBuildId(null);
      void queryClient.invalidateQueries({ queryKey: ['runtime-customization-status'] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      dashboardApi.exportCustomization({ artifact_type: 'manifest', format: 'json' }),
  });

  function handleValidate(): void {
    buildMutation.reset();
    linkMutation.reset();
    exportMutation.reset();
    validateMutation.mutate();
  }

  function handleBuild(): void {
    validateMutation.reset();
    linkMutation.reset();
    exportMutation.reset();
    buildMutation.mutate();
  }

  function handleLink(): void {
    if (!lastBuildId) {
      return;
    }
    validateMutation.reset();
    buildMutation.reset();
    exportMutation.reset();
    linkMutation.mutate(lastBuildId);
  }

  function handleExport(): void {
    validateMutation.reset();
    buildMutation.reset();
    linkMutation.reset();
    exportMutation.mutate();
  }

  const anyPending =
    validateMutation.isPending ||
    buildMutation.isPending ||
    linkMutation.isPending ||
    exportMutation.isPending;

  const validationOutcome = validateMutation.data
    ? describeValidationOutcome(validateMutation.data)
    : null;
  const buildOutcome = buildMutation.data ? describeBuildOutcome(buildMutation.data) : null;
  const linkOutcome = linkMutation.data ? describeLinkOutcome(linkMutation.data) : null;
  const exportOutcome = exportMutation.data ? describeExportOutcome(exportMutation.data) : null;

  const mutationError =
    validateMutation.error ?? buildMutation.error ?? linkMutation.error ?? exportMutation.error;

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Runtime Management</CardTitle>
        <p className="text-sm text-muted">
          Validate, build, link, and export runtime image artifacts from the reconstructed manifest.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleValidate} disabled={anyPending}>
            {validateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="h-3 w-3" />
            )}
            Validate manifest
          </Button>
          <Button variant="outline" size="sm" onClick={handleBuild} disabled={anyPending}>
            {buildMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Hammer className="h-3 w-3" />
            )}
            Build runtime image
          </Button>
          {lastBuildId ? (
            <Button variant="outline" size="sm" onClick={handleLink} disabled={anyPending}>
              {linkMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Link2 className="h-3 w-3" />
              )}
              Link build
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={anyPending}>
            {exportMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileDown className="h-3 w-3" />
            )}
            Export manifest
          </Button>
        </div>

        {validationOutcome ? (
          <RuntimeActionResult
            tone={validationOutcome.valid ? 'linked' : 'failed'}
            headline={validationOutcome.headline}
          >
            {validationOutcome.errors.length > 0 ? (
              <ul className="mt-2 grid gap-1">
                {validationOutcome.errors.map((error) => (
                  <li key={error.field} className="text-xs text-muted">
                    <span className="font-mono">{error.field}</span>: {error.message} &mdash;{' '}
                    {error.remediation}
                  </li>
                ))}
              </ul>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {buildOutcome ? (
          <RuntimeActionResult tone={buildOutcome.tone} headline={buildOutcome.headline}>
            <p className="mt-1 text-xs text-muted">{buildOutcome.detail}</p>
            {buildMutation.data?.gates && buildMutation.data.gates.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                Gates: {describeGatesSummary(buildMutation.data.gates)}
              </p>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {linkOutcome ? (
          <RuntimeActionResult tone={linkOutcome.tone} headline={linkOutcome.headline}>
            <p className="mt-1 text-xs text-muted">{linkOutcome.detail}</p>
          </RuntimeActionResult>
        ) : null}

        {exportOutcome ? (
          <RuntimeActionResult
            tone={exportOutcome.hasContent ? 'linked' : 'valid'}
            headline={exportOutcome.headline}
          >
            <p className="mt-1 text-xs text-muted">{exportOutcome.detail}</p>
            {exportOutcome.hasContent && exportMutation.data?.content ? (
              <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-border/70 bg-background/70 p-3 text-xs font-mono">
                {exportMutation.data.content}
              </pre>
            ) : null}
          </RuntimeActionResult>
        ) : null}

        {mutationError ? (
          <p className="text-sm text-destructive">
            {mutationError instanceof Error
              ? mutationError.message
              : 'Action failed. Check service connectivity.'}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
