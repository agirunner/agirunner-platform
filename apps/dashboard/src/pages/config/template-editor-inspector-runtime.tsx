/**
 * Runtime inspector panel — agent + task container configuration.
 */
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { AlertTriangle, Zap, Server } from 'lucide-react';
import type { RuntimeConfig, TaskContainerConfig, PullPolicy } from './template-editor-types.js';
import { PULL_POLICIES } from './template-editor-types.js';
import { HelpText, FieldLabel, SectionHeader } from './template-editor-inspector-shared.js';

// ---------------------------------------------------------------------------
// Runtime inspector
// ---------------------------------------------------------------------------

export function RuntimeInspector({
  runtime,
  taskContainer,
  isPublished,
  onUpdateRuntime: onUpdateRt,
  onUpdateTaskContainer: onUpdateTc,
}: {
  runtime: RuntimeConfig | undefined;
  taskContainer: TaskContainerConfig | undefined;
  isPublished: boolean;
  onUpdateRuntime: (rt: RuntimeConfig | undefined) => void;
  onUpdateTaskContainer: (tc: TaskContainerConfig | undefined) => void;
}) {
  const isWarm = runtime?.pool_mode === 'warm';

  const enableWarm = () => {
    onUpdateRt({
      pool_mode: 'warm',
      max_runtimes: runtime?.max_runtimes ?? 2,
      priority: runtime?.priority ?? 50,
      idle_timeout_seconds: runtime?.idle_timeout_seconds ?? 300,
      grace_period_seconds: runtime?.grace_period_seconds ?? 30,
      image: runtime?.image ?? 'agirunner-runtime:local',
      pull_policy: runtime?.pull_policy ?? 'if-not-present',
      cpu: runtime?.cpu ?? '1.0',
      memory: runtime?.memory ?? '512m',
    });
  };

  const disableWarm = () => {
    onUpdateRt({ ...runtime, pool_mode: 'cold' });
    onUpdateTc({ ...taskContainer, warm_pool_size: 0 });
  };

  const updateRt = (patch: Partial<RuntimeConfig>) => onUpdateRt({ ...runtime, ...patch });
  const updateTc = (patch: Partial<TaskContainerConfig>) => onUpdateTc({ ...taskContainer, ...patch });

  const maxRt = runtime?.max_runtimes ?? 0;
  const rtCpu = parseFloat(runtime?.cpu ?? '0') || 0;
  const rtMem = runtime?.memory ?? '0';
  const warmPoolSize = taskContainer?.warm_pool_size ?? 0;
  const tcCpu = parseFloat(taskContainer?.cpu ?? '0') || 0;
  const tcMem = taskContainer?.memory ?? '0';

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

          <div className="p-4 rounded-lg border border-amber-200 bg-amber-50 space-y-3">
            <span className="text-sm font-medium text-amber-900">Enable Warm Containers</span>
            <p className="text-xs text-amber-800">
              Reserve running agent and task containers so workflows start in seconds.
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
          <div className="p-4 rounded-lg border border-green-200 bg-green-50 space-y-2">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium text-green-900">Warm Mode Active</span>
            </div>
            <p className="text-xs text-green-800">
              The platform keeps agent containers running for instant task dispatch.
              {!isPublished && ' Publish this template to activate warm containers.'}
            </p>
            <Button size="sm" variant="outline" onClick={disableWarm}>Switch to Cold</Button>
          </div>

          {/* Resource impact */}
          <div className="p-3 rounded-md bg-background border border-border/50 text-xs space-y-1">
            <span className="font-semibold">Resource Impact</span>
            <p className="text-muted">Agents: {maxRt} × ({runtime?.cpu ?? '?'} CPU, {rtMem})</p>
            {warmPoolSize > 0 && (
              <p className="text-muted">Tasks: {warmPoolSize} × ({taskContainer?.cpu ?? '?'} CPU, {tcMem})</p>
            )}
            <p className="font-medium pt-1 border-t border-border/30">
              Total: {(maxRt * rtCpu + warmPoolSize * tcCpu).toFixed(1)} CPU, {maxRt > 0 || warmPoolSize > 0 ? `${maxRt} × ${rtMem}${warmPoolSize > 0 ? ` + ${warmPoolSize} × ${tcMem}` : ''} memory` : '0 memory'}
            </p>
          </div>

          {/* Agent container */}
          <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
            <h5 className="text-xs font-semibold">Agent Container</h5>
            <HelpText>The long-running agent process that receives and executes tasks.</HelpText>

            <FieldLabel label="Max Runtimes">
              <Input
                type="number" min={1}
                value={runtime?.max_runtimes ?? 2}
                onChange={(e) => updateRt({ max_runtimes: Math.max(1, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Maximum concurrent agent containers for this template (min 1).</HelpText>
            </FieldLabel>

            <FieldLabel label="Priority">
              <Input
                type="number" min={0} max={100}
                value={runtime?.priority ?? 50}
                onChange={(e) => updateRt({ priority: Math.min(100, Math.max(0, Number(e.target.value))) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Scheduling weight (0-100). Higher priority templates get containers first.</HelpText>
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

            <FieldLabel label="Grace Period (seconds)">
              <Input
                type="number" min={0}
                value={runtime?.grace_period_seconds ?? 30}
                onChange={(e) => updateRt({ grace_period_seconds: Math.max(0, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Seconds to finish current work before forced shutdown.</HelpText>
            </FieldLabel>

            <FieldLabel label="Image">
              <Input
                value={runtime?.image ?? 'agirunner-runtime:local'}
                onChange={(e) => updateRt({ image: e.target.value })}
                className="mt-1 h-7 text-xs font-mono"
              />
              <HelpText>Docker image for the agent container (e.g. agirunner-runtime:local).</HelpText>
            </FieldLabel>

            <FieldLabel label="Pull Policy">
              <Select
                value={runtime?.pull_policy ?? 'if-not-present'}
                onValueChange={(v) => updateRt({ pull_policy: v as PullPolicy })}
              >
                <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">always — pull on every start</SelectItem>
                  <SelectItem value="if-not-present">if-not-present — pull only if missing locally</SelectItem>
                  <SelectItem value="never">never — use local image only</SelectItem>
                </SelectContent>
              </Select>
              <HelpText>When to pull the container image from the registry.</HelpText>
            </FieldLabel>

            <div className="grid grid-cols-2 gap-2">
              <FieldLabel label="CPU">
                <Input
                  value={runtime?.cpu ?? '1.0'}
                  onChange={(e) => updateRt({ cpu: e.target.value })}
                  className="mt-1 h-7 text-xs"
                />
                <HelpText>e.g. 0.5, 1.0, 2.0</HelpText>
              </FieldLabel>
              <FieldLabel label="Memory">
                <Input
                  value={runtime?.memory ?? '512m'}
                  onChange={(e) => updateRt({ memory: e.target.value })}
                  className="mt-1 h-7 text-xs"
                />
                <HelpText>e.g. 256m, 512m, 1g</HelpText>
              </FieldLabel>
            </div>
          </div>

          {/* Task container */}
          <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
            <h5 className="text-xs font-semibold">Task Container</h5>
            <HelpText>Isolated sandbox where the agent runs shell commands, clones repos, and executes tools.</HelpText>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium">Warm Pool</span>
                <HelpText>Keep pre-warmed task sandboxes ready for instant use.</HelpText>
              </div>
              <Switch
                checked={taskContainer?.pool_mode === 'warm'}
                onCheckedChange={(v) => updateTc({ pool_mode: v ? 'warm' : 'cold', warm_pool_size: v ? 1 : 0 })}
              />
            </div>

            {taskContainer?.pool_mode === 'warm' && (
              <FieldLabel label="Warm Pool Size">
                <Input
                  type="number" min={1}
                  value={taskContainer?.warm_pool_size ?? 1}
                  onChange={(e) => updateTc({ warm_pool_size: Math.max(1, Number(e.target.value)) })}
                  className="mt-1 h-7 text-xs"
                />
                <HelpText>Number of pre-warmed sandbox containers kept ready.</HelpText>
              </FieldLabel>
            )}

            <FieldLabel label="Image">
              <Input
                value={taskContainer?.image ?? 'alpine:latest'}
                onChange={(e) => updateTc({ image: e.target.value })}
                className="mt-1 h-7 text-xs font-mono"
              />
              <HelpText>Base OS for task sandbox. Use a minimal image — agents install their own tools.</HelpText>
            </FieldLabel>

            <FieldLabel label="Pull Policy">
              <Select
                value={taskContainer?.pull_policy ?? 'if-not-present'}
                onValueChange={(v) => updateTc({ pull_policy: v as PullPolicy })}
              >
                <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">always — pull on every start</SelectItem>
                  <SelectItem value="if-not-present">if-not-present — pull only if missing</SelectItem>
                  <SelectItem value="never">never — local image only</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>

            <div className="grid grid-cols-2 gap-2">
              <FieldLabel label="CPU">
                <Input
                  value={taskContainer?.cpu ?? '0.5'}
                  onChange={(e) => updateTc({ cpu: e.target.value })}
                  className="mt-1 h-7 text-xs"
                />
                <HelpText>e.g. 0.5, 1.0</HelpText>
              </FieldLabel>
              <FieldLabel label="Memory">
                <Input
                  value={taskContainer?.memory ?? '256m'}
                  onChange={(e) => updateTc({ memory: e.target.value })}
                  className="mt-1 h-7 text-xs"
                />
                <HelpText>e.g. 256m, 512m</HelpText>
              </FieldLabel>
            </div>
          </div>

          {!isPublished && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
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
