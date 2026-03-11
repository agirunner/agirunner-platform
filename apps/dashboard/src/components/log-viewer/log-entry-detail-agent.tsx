interface Props {
  payload: Record<string, unknown>;
}

export function LogEntryDetailAgent({ payload }: Props): JSX.Element | null {
  const systemPrompt = payload.system_prompt;
  if (typeof systemPrompt !== 'string' || systemPrompt === '') return null;

  return (
    <div className="rounded-md border border-border p-4">
      <h4 className="mb-3 text-sm font-semibold">System Prompt</h4>
      <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words rounded bg-card p-3 text-xs leading-relaxed">
        {systemPrompt}
      </pre>
    </div>
  );
}
