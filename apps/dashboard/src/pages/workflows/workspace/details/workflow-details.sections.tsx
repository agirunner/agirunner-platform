import type { DashboardWorkflowInputPacketFileRecord } from '../../../../lib/api.js';
import { dashboardApi } from '../../../../lib/api.js';
import type { CompactRow } from './workflow-details.support.js';

export function BriefSection(props: {
  title: string;
  children: JSX.Element;
  className?: string;
}): JSX.Element {
  const className = props.className ? `space-y-2 ${props.className}` : 'space-y-2';
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </p>
      {props.children}
    </div>
  );
}

export function Narrative(props: {
  paragraphs: string[];
  fallback: string;
}): JSX.Element {
  const paragraphs = props.paragraphs.length > 0 ? props.paragraphs : [props.fallback];

  return (
    <div className="grid gap-2">
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-sm leading-6 text-foreground">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

export function WhatExistsNowBody(props: {
  rows: CompactRow[];
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  if (props.rows.length === 0 && props.files.length === 0) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        Nothing has been attached to this scope yet.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {props.rows.length > 0 ? <CompactRowList rows={props.rows} /> : null}
      {props.files.length > 0 ? <PacketFileList files={props.files} /> : null}
    </div>
  );
}

function CompactRowList(props: { rows: CompactRow[] }): JSX.Element {
  return (
    <div
      data-workflows-details-what-exists="rows"
      className="pr-1"
    >
      <ul className="grid divide-y divide-border/60">
        {props.rows.map((row) => {
          const metadata = buildRowMetadata(row);
          return (
            <li key={row.id} className="py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-sm text-foreground">{row.title}</p>
                {metadata ? <p className="text-xs text-muted-foreground">{metadata}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PacketFileList(props: {
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Input attachments
      </p>
      <div className="flex flex-wrap gap-2">
        {props.files.map((file) => (
          <button
            key={file.id}
            type="button"
            className="inline-flex items-center rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
            onClick={() => void downloadPacketFile(file)}
          >
            {file.file_name}
          </button>
        ))}
      </div>
    </div>
  );
}

function buildRowMetadata(row: CompactRow): string | null {
  const parts = [row.subtitle, row.status].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' • ') : null;
}

async function downloadPacketFile(file: DashboardWorkflowInputPacketFileRecord): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }
  const download = await dashboardApi.downloadBinaryByHref(file.download_url);
  const objectUrl = URL.createObjectURL(download.blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = download.file_name ?? file.file_name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
