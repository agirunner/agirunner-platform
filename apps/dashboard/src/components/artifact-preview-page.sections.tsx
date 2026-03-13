import { FileText, Package } from 'lucide-react';

import { MAX_INLINE_ARTIFACT_PREVIEW_BYTES } from './artifact-preview-support.js';
import { formatArtifactPreviewFileSize } from './artifact-preview-page.support.js';

export function BinaryPreviewNotice(props: { artifactSize: number }): JSX.Element {
  return (
    <PreviewStateNotice
      title="Download-only artifact"
      body={`This artifact cannot be rendered safely inline. Download the original file to inspect ${formatArtifactPreviewFileSize(props.artifactSize)} of source material.`}
      accent="muted"
      icon={<Package className="h-4 w-4" />}
    />
  );
}

export function LargePreviewNotice(props: { artifactSize: number }): JSX.Element {
  return (
    <PreviewStateNotice
      title="Inline preview limit reached"
      body={`Inline preview is limited to ${formatArtifactPreviewFileSize(MAX_INLINE_ARTIFACT_PREVIEW_BYTES)} to keep the operator surface responsive. This artifact is ${formatArtifactPreviewFileSize(props.artifactSize)}.`}
      accent="muted"
      icon={<FileText className="h-4 w-4" />}
    />
  );
}

export function ArtifactMetadataCard(props: {
  label: string;
  value: string;
  helper: string;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </p>
      <p className="mt-2 break-all text-sm font-medium">{props.value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{props.helper}</p>
    </div>
  );
}

export function PreviewStateNotice(props: {
  title: string;
  body: string;
  accent: 'muted' | 'danger';
  icon: JSX.Element;
}): JSX.Element {
  const className =
    props.accent === 'danger'
      ? 'border-rose-200 bg-rose-50/80 text-rose-900'
      : 'border-border/70 bg-muted/30 text-foreground';
  return (
    <div className={`rounded-2xl border p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-xl border border-current/10 bg-background/80 p-2">
          {props.icon}
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold">{props.title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{props.body}</p>
        </div>
      </div>
    </div>
  );
}
