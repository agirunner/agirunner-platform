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

  return (
    <article
      data-terminal-entry={entryStyle.dataKind}
      data-terminal-source={item.source_kind}
      className={`grid gap-1 px-4 py-2 font-mono leading-6 text-sm text-slate-100 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3 ${entryStyle.entryClassName}`}
    >
      <p className="min-w-0 break-words text-slate-100">
        <span className={entryStyle.promptClassName}>&gt; </span>
        <span className={`font-semibold ${entryStyle.sourceClassName}`}>{sourceLabel}: </span>
        {entryPrefix ? <span className="font-semibold text-emerald-200">{entryPrefix} </span> : null}
        <span className="text-slate-100">{getWorkflowConsoleLineText(item)}</span>
      </p>
      <span className="pl-[1.35rem] text-left text-xs text-slate-500 sm:pl-0 sm:text-right">
        {formatRelativeTimestamp(item.created_at)}
      </span>
    </article>
  );
}
