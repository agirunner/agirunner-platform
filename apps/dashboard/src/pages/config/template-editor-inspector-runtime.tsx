/**
 * Runtime inspector panel — agent container warm/cold configuration.
 *
 * Templates can override runtime defaults (image, CPU, memory, etc.)
 * via an optional collapsible section. Unset fields inherit from
 * the platform-wide runtime defaults page.
 */
import { useState } from 'react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { AlertTriangle, Zap, Server, ChevronDown, ChevronRight } from 'lucide-react';
import type { RuntimeConfig, PullPolicy } from './template-editor-types.js';
import { PULL_POLICIES } from './template-editor-types.js';
import { HelpText, FieldLabel, SectionHeader } from './template-editor-inspector-shared.js';

// ---------------------------------------------------------------------------
// Runtime inspector
// ---------------------------------------------------------------------------

export function RuntimeInspector({
  runtime,
  isPublished,
  onUpdateRuntime: onUpdateRt,
}: {
  runtime: RuntimeConfig | undefined;
  isPublished: boolean;
  onUpdateRuntime: (rt: RuntimeConfig | undefined) => void;
}) {
  const isWarm = runtime?.pool_mode === 'warm';
  const [showOverrides, setShowOverrides] = useState(false);

  const enableWarm = () => {
    onUpdateRt({
      pool_mode: 'warm',
      max_runtimes: runtime?.max_runtimes ?? 2,
      priority: runtime?.priority ?? 50,
      idle_timeout_seconds: runtime?.idle_timeout_seconds ?? 300,
    });
  };

  const disableWarm = () => {
    onUpdateRt({ ...runtime, pool_mode: 'cold' });
  };

  const updateRt = (patch: Partial<RuntimeConfig>) => onUpdateRt({ ...runtime, ...patch });

  const hasOverrides = Boolean(
    runtime?.image || runtime?.pull_policy || runtime?.cpu || runtime?.memory || runtime?.grace_period_seconds,
  );

  return (
    <div className="space-y-4">
      <SectionHeader title="Runtime" description="Container reservation and resource configuration." />

      {!isWarm ? (
        <>
          <div className="p-4 rounded-lg border border-border bg-background space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted" />
              <span className="text-sm font-medium">Cold Start Mode</span>
            </div>
            <p className="text-xs text-muted">
              Workflows start containers on demand. No resources are reserved when idle.
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>• Lowest cost — no idle resource usage</li>
              <li>• Slower start — each run provisions fresh containers (~10-30s)</li>
            </ul>
          </div>

          <div className="p-4 rounded-lg border border-amber-600/30 bg-amber-500/10 space-y-3">
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Enable Warm Containers</span>
            <p className="text-xs text-amber-800 dark:text-amber-300/80">
              Reserve running agent containers so workflows start in seconds.
              Containers consume resources even when idle.
            </p>
            <Button size="sm" onClick={enableWarm}>Enable Warm Mode</Button>
          </div>

          <p className="text-[11px] text-muted">
            Template must be published for the platform to provision warm containers.
          </p>
        </>
      ) : (
        <>
          <div className="p-4 rounded-lg border border-green-600/30 bg-green-500/10 space-y-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">Warm Mode Active</span>
            </div>
            <p className="text-xs text-green-800 dark:text-green-300/80">
              The platform keeps agent containers running for instant task dispatch.
              {!isPublished && ' Publish this template to activate warm containers.'}
            </p>
            <Button size="sm" variant="outline" onClick={disableWarm}>Switch to Cold</Button>
          </div>

          {/* Core warm-mode settings */}
          <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
            <h5 className="text-xs font-semibold">Warm Pool Settings</h5>

            <FieldLabel label="Priority">
              <Input
                type="number" min={0} max={100}
                value={runtime?.priority ?? 50}
                onChange={(e) => updateRt({ priority: Math.min(100, Math.max(0, Number(e.target.value))) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Scheduling weight (0-100). Higher priority templates get containers first.</HelpText>
            </FieldLabel>

            <FieldLabel label="Max Runtimes">
              <Input
                type="number" min={1}
                value={runtime?.max_runtimes ?? 2}
                onChange={(e) => updateRt({ max_runtimes: Math.max(1, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Maximum concurrent agent containers for this template (min 1).</HelpText>
            </FieldLabel>

            <FieldLabel label="Idle Timeout (seconds)">
              <Input
                type="number" min={0}
                value={runtime?.idle_timeout_seconds ?? 300}
                onChange={(e) => updateRt({ idle_timeout_seconds: Math.max(0, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Seconds idle before shutting down. 0 = keep alive indefinitely.</HelpText>
            </FieldLabel>
          </div>

          {/* Collapsible override defaults */}
          <div className="rounded-md border border-border/50 bg-background">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-border/20 transition-colors"
              onClick={() => setShowOverrides(!showOverrides)}
            >
              {showOverrides ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Override Defaults
              {hasOverrides && <span className="ml-auto text-[10px] text-amber-600 font-normal">overrides set</span>}
            </button>

            {showOverrides && (
              <div className="space-y-3 px-3 pb-3 border-t border-border/30 pt-3">
                <p className="text-[11px] text-muted">
                  Leave blank to use runtime defaults. Only set values you want to override for this template.
                </p>

                <FieldLabel label="Image">
                  <Input
                    value={runtime?.image ?? ''}
                    onChange={(e) => updateRt({ image: e.target.value || undefined })}
                    placeholder="agirunner-runtime:local"
                    className="mt-1 h-7 text-xs font-mono"
                  />
                  <HelpText>Docker image for the agent container.</HelpText>
                </FieldLabel>

                <FieldLabel label="Pull Policy">
                  <Select
                    value={runtime?.pull_policy ?? ''}
                    onValueChange={(v) => updateRt({ pull_policy: (v || undefined) as PullPolicy | undefined })}
                  >
                    <SelectTrigger className="mt-1 h-7 text-xs">
                      <SelectValue placeholder="Use default" />
                    </SelectTrigger>
                    <SelectContent>
                      {PULL_POLICIES.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <HelpText>When to pull the container image from the registry.</HelpText>
                </FieldLabel>

                <div className="grid grid-cols-2 gap-2">
                  <FieldLabel label="CPU">
                    <Input
                      value={runtime?.cpu ?? ''}
                      onChange={(e) => updateRt({ cpu: e.target.value || undefined })}
                      placeholder="1"
                      className="mt-1 h-7 text-xs"
                    />
                    <HelpText>e.g. 0.5, 1.0, 2.0</HelpText>
                  </FieldLabel>
                  <FieldLabel label="Memory">
                    <Input
                      value={runtime?.memory ?? ''}
                      onChange={(e) => updateRt({ memory: e.target.value || undefined })}
                      placeholder="256m"
                      className="mt-1 h-7 text-xs"
                    />
                    <HelpText>e.g. 256m, 512m, 1g</HelpText>
                  </FieldLabel>
                </div>

                <FieldLabel label="Grace Period (seconds)">
                  <Input
                    type="number" min={0}
                    value={runtime?.grace_period_seconds ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateRt({ grace_period_seconds: val ? Math.max(0, Number(val)) : undefined });
                    }}
                    placeholder="30"
                    className="mt-1 h-7 text-xs"
                  />
                  <HelpText>Seconds to finish current work before forced shutdown.</HelpText>
                </FieldLabel>
              </div>
            )}
          </div>

          {!isPublished && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 border border-amber-600/30 text-xs text-amber-800 dark:text-amber-300/80">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                Warm containers are only provisioned for published templates. Draft templates always
                cold-start. Publish this template to activate warm mode.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
