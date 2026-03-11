/**
 * Config-related inspector panels: Config, DefaultInstructionConfig, Metadata.
 */
import { SectionHeader, HelpText, ExpandableTextarea, JsonObjectEditor } from './template-editor-inspector-shared.js';

// ---------------------------------------------------------------------------
// Config inspector (schema.config)
// ---------------------------------------------------------------------------

export function ConfigInspector({
  config,
  onUpdate,
}: {
  config: Record<string, unknown> | undefined;
  onUpdate: (c: Record<string, unknown> | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Config"
        description="Top-level configuration object for this template. Available to all tasks at runtime."
      />
      <JsonObjectEditor
        value={config}
        onChange={onUpdate}
        rows={10}
        placeholder='{\n  "max_file_size": 10000,\n  "language": "typescript"\n}'
      />
      <HelpText>
        Arbitrary JSON configuration. Tasks can read these values to control their behavior.
      </HelpText>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default Instruction Config inspector
// ---------------------------------------------------------------------------

export function DefaultInstructionConfigInspector({
  instructionConfig,
  onUpdate,
}: {
  instructionConfig: Record<string, unknown> | undefined;
  onUpdate: (c: Record<string, unknown> | undefined) => void;
}) {
  const instructions = typeof instructionConfig?.instructions === 'string'
    ? instructionConfig.instructions
    : '';

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Default Instructions"
        description="Default instructions applied to all tasks unless overridden at the task level."
      />
      <ExpandableTextarea
        value={instructions}
        onChange={(v) => {
          if (!v.trim()) {
            onUpdate(undefined);
          } else {
            onUpdate({ ...instructionConfig, instructions: v });
          }
        }}
        placeholder="Instructions shared across all tasks in this template..."
        label="Default Instructions"
        rows={10}
      />
      <HelpText>
        Shared instructions prepended to every task in this template. Individual tasks can add
        task-specific instructions that supplement these defaults.
      </HelpText>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Metadata inspector
// ---------------------------------------------------------------------------

export function MetadataInspector({
  metadata,
  onUpdate,
}: {
  metadata: Record<string, unknown> | undefined;
  onUpdate: (m: Record<string, unknown> | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Metadata"
        description="Arbitrary metadata attached to this template. Not used by the runtime — for organizational purposes."
      />
      <JsonObjectEditor
        value={metadata}
        onChange={onUpdate}
        rows={4}
        placeholder='{\n  "team": "platform",\n  "category": "ci-cd"\n}'
      />
      <HelpText>
        Tags, categories, team ownership, or any other data you want to track.
        Metadata is preserved through version updates.
      </HelpText>
    </div>
  );
}
