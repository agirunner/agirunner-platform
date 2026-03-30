import type { DashboardWorkflowInputPacketFileRecord } from '../../../../lib/api.js';
import type { CompactRow } from './workflow-details.support.js';

export function BriefSection(props: {
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="grid gap-2">
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
    <div className="grid gap-3">
      {props.rows.length > 0 ? <CompactRowList rows={props.rows} /> : null}
      {props.files.length > 0 ? <PacketFileList files={props.files} /> : null}
    </div>
  );
}

function CompactRowList(props: { rows: CompactRow[] }): JSX.Element {
  const shouldBoundHeight = props.rows.length > 5;

  return (
    <div
      className={
        shouldBoundHeight ? 'max-h-[16rem] overflow-y-auto overscroll-contain pr-1' : undefined
      }
    >
      <ul className="grid divide-y divide-border/60">
        {props.rows.map((row) => (
          <li
            key={row.id}
            className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm text-foreground">{row.title}</p>
              {row.subtitle ? (
                <p className="text-xs text-muted-foreground">{row.subtitle}</p>
              ) : null}
            </div>
            {row.status ? (
              <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PacketFileList(props: {
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {props.files.map((file) => (
        <a
          key={file.id}
          className="inline-flex items-center rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
          href={file.download_url}
          target="_blank"
          rel="noreferrer"
        >
          {file.file_name}
        </a>
      ))}
    </div>
  );
}
