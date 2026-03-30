import type { DashboardWorkflowLiveConsolePacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import {
  getWorkflowConsoleDetailText,
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
  const detailText = getWorkflowConsoleDetailText(item);
  const title = detailText ? `${sourceLabel}: ${lineText} — ${detailText}` : `${sourceLabel}: ${lineText}`;

  return (
    <article
      data-terminal-entry={entryStyle.dataKind}
      data-terminal-source={item.source_kind}
      className={`flex min-w-0 items-start gap-2 border-b border-slate-950/90 px-4 py-2 font-mono text-sm leading-6 text-slate-100 last:border-b-0 ${entryStyle.entryClassName}`}
    >
      <span className={`self-start ${entryStyle.promptClassName}`}>&gt;</span>
      <div className="min-w-0 flex-1" title={title}>
        <p className="truncate text-slate-100">
          <span className={`font-semibold ${entryStyle.sourceClassName}`}>{sourceLabel}: </span>
          {entryPrefix ? <span className="font-semibold text-emerald-200">{entryPrefix} </span> : null}
          <span className="text-slate-100">{lineText}</span>
        </p>
        {detailText ? <p className="truncate text-xs leading-5 text-slate-400">{detailText}</p> : null}
      </div>
      <span className="shrink-0 pl-3 text-right text-xs tabular-nums text-slate-500">
        {formatRelativeTimestamp(item.created_at)}
      </span>
    </article>
  );
}
