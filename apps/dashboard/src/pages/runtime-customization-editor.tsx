import type { RuntimeCustomizationDraft } from './runtime-customization-form.js';

export function RuntimeCustomizationEditor({
  draft,
  onChange,
}: {
  draft: RuntimeCustomizationDraft;
  onChange: <K extends keyof RuntimeCustomizationDraft>(
    field: K,
    value: RuntimeCustomizationDraft[K],
  ) => void;
}): JSX.Element {
  return (
    <div className="grid two">
      <TextField
        id="customization-template"
        label="Template"
        value={draft.template}
        onChange={(value) => onChange('template', value)}
      />
      <TextField
        id="customization-base-image"
        label="Base image digest"
        value={draft.baseImage}
        onChange={(value) => onChange('baseImage', value)}
      />
      <TextAreaField
        id="customization-apt"
        label="APT packages"
        value={draft.aptPackages}
        onChange={(value) => onChange('aptPackages', value)}
      />
      <TextAreaField
        id="customization-npm"
        label="Global npm packages"
        value={draft.npmGlobalPackages}
        onChange={(value) => onChange('npmGlobalPackages', value)}
      />
      <TextAreaField
        id="customization-pip"
        label="Pip packages"
        value={draft.pipPackages}
        onChange={(value) => onChange('pipPackages', value)}
      />
      <TextAreaField
        id="customization-files"
        label="Managed files"
        value={draft.managedFiles}
        onChange={(value) => onChange('managedFiles', value)}
        placeholder="./ops/tooling.env => /workspace/.env"
      />
      <TextField
        id="customization-setup-path"
        label="Setup script path"
        value={draft.setupScriptPath}
        onChange={(value) => onChange('setupScriptPath', value)}
      />
      <TextField
        id="customization-setup-sha"
        label="Setup script SHA-256"
        value={draft.setupScriptSha256}
        onChange={(value) => onChange('setupScriptSha256', value)}
      />
      <TextField
        id="customization-template-version"
        label="Template version"
        value={draft.templateVersion}
        onChange={(value) => onChange('templateVersion', value)}
      />
      <TextField
        id="customization-policy-bundle"
        label="Policy bundle version"
        value={draft.policyBundleVersion}
        onChange={(value) => onChange('policyBundleVersion', value)}
      />
      <TextAreaField
        id="customization-lock-digests"
        label="Lock digests"
        value={draft.lockDigests}
        onChange={(value) => onChange('lockDigests', value)}
        placeholder="package-lock.json=sha256:1234"
      />
      <TextAreaField
        id="customization-secret-refs"
        label="Secret refs"
        value={draft.secretRefs}
        onChange={(value) => onChange('secretRefs', value)}
        placeholder="runtime-api@v1"
      />
      <TextField
        id="customization-environment"
        label="Environment"
        value={draft.environment}
        onChange={(value) => onChange('environment', value)}
      />
      <TextField
        id="customization-sbom-format"
        label="SBOM format"
        value={draft.sbomFormat}
        onChange={(value) => onChange('sbomFormat', value)}
      />
      <TextField
        id="customization-critical-findings"
        label="Critical findings"
        value={draft.criticalFindings}
        onChange={(value) => onChange('criticalFindings', value)}
      />
      <TextField
        id="customization-high-findings"
        label="High findings"
        value={draft.highFindings}
        onChange={(value) => onChange('highFindings', value)}
      />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </>
  );
}
