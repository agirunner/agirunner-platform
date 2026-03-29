import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  formatWorkflowActivitySourceLabel,
  getWorkflowConsoleEntryPrefix,
  getWorkflowConsoleEntryStyle,
  getWorkflowConsoleLineText,
} from './workflow-live-console.support.js';

export function WorkflowLiveConsoleEntry(props: {
  item: DashboardWorkflowLiveConsolePacket['items'][number];
}): JSX.Element {
  const { item } = props;
  const sourceLabel = formatWorkflowActivitySourceLabel(item.source_label, item.source_kind);
  const entryStyle = getWorkflowConsoleEntryStyle(item.item_kind, item.source_kind);
  const entryPrefix = getWorkflowConsoleEntryPrefix(item);
  const lineText = getWorkflowConsoleLineText(item);

  return (
    <article
      data-terminal-entry={entryStyle.dataKind}
      data-terminal-source={item.source_kind}
      className={`grid min-w-0 grid-cols-[max-content_minmax(0,1fr)_max-content] items-baseline gap-2 border-b border-slate-950/90 px-4 py-2 font-mono text-sm leading-6 text-slate-100 last:border-b-0 ${entryStyle.entryClassName}`}
    >
      <span className={`self-start ${entryStyle.promptClassName}`}>&gt;</span>
      <p
        className="min-w-0 truncate text-slate-100"
        title={`${sourceLabel}: ${lineText}`}
      >
        <span className={`font-semibold ${entryStyle.sourceClassName}`}>{sourceLabel}: </span>
        {entryPrefix ? <span className="font-semibold text-emerald-200">{entryPrefix} </span> : null}
        <span className="text-slate-100">{lineText}</span>
      </p>
      <span className="shrink-0 pl-2 text-right text-xs text-slate-500">
        {formatRelativeTimestamp(item.created_at)}
      </span>
    </article>
  );
}
