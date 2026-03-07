export function LlmProvidersPage(): JSX.Element {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">LLM Providers</h1>
      <p className="text-muted-foreground">
        Configure large language model providers, API keys, model selections,
        and rate limits. Manage provider priorities and fallback strategies
        for your agents.
      </p>
    </div>
  );
}
