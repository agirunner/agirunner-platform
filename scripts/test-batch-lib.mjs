import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..');
export const DEFAULTS_PATH = path.join(ROOT, 'tests/batch/defaults.json');
export const ALLOWED_PROVIDERS = ['openai', 'google', 'anthropic'];

export function nowIso() {
  return new Date().toISOString();
}

export function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function parseEnvFile(filePath) {
  const data = readFileSync(filePath, 'utf8');
  for (const line of data.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadBatchEnv() {
  const files = ['.env.test-batch', '.env.test-batch.local'];
  for (const fileName of files) {
    try {
      parseEnvFile(path.join(ROOT, fileName));
    } catch {
      // optional env files
    }
  }
}

export function usage() {
  console.log(`Usage: pnpm test:batch [options]

Options:
  --mode sequential|parallel      Execution mode (default: sequential)
  --fail-fast                     Stop scheduling new stages after first failure
  --continue-on-error             Execute all stages despite failures (default)
  --providers <csv>               Subset: openai,google,anthropic (default: openai)
  --report-dir <path>             Output directory (default: tests/artifacts/batch/run-<timestamp>)
  --dry-run                       Write manifest/reports without running tests
  -h, --help                      Show this help message
`);
}

export function parseArgs(argv, defaults) {
  const options = {
    mode: defaults.defaultMode ?? 'sequential',
    failurePolicy: defaults.defaultFailurePolicy ?? 'continue-on-error',
    providers: [...(defaults.defaultProviders ?? ['openai'])],
    providersExplicit: false,
    reportDir: null,
    dryRun: false,
    parallelMax: Number(process.env.BATCH_PARALLEL_MAX ?? defaults.parallel?.maxConcurrency ?? 3),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--mode') {
      options.mode = String(argv[++i] ?? '');
    } else if (arg === '--fail-fast') {
      options.failurePolicy = 'fail-fast';
    } else if (arg === '--continue-on-error') {
      options.failurePolicy = 'continue-on-error';
    } else if (arg === '--providers') {
      const raw = String(argv[++i] ?? '');
      options.providersExplicit = true;
      options.providers = raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === '--report-dir') {
      options.reportDir = String(argv[++i] ?? '');
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['sequential', 'parallel'].includes(options.mode)) {
    throw new Error(`--mode must be sequential or parallel (received: ${options.mode})`);
  }

  if (options.providers.length === 0) {
    throw new Error('--providers must include at least one provider');
  }

  for (const provider of options.providers) {
    if (!ALLOWED_PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  return options;
}

const PROVIDER_ENV_REQUIREMENTS = {
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
};

export function filterProvidersWithEnv(providers, dryRun) {
  if (dryRun) {
    return { selected: [...providers], missing: [] };
  }

  const selected = [];
  const missing = [];

  for (const provider of providers) {
    const keys = PROVIDER_ENV_REQUIREMENTS[provider] ?? [];
    const hasAny = keys.some((key) => (process.env[key] ?? '').trim().length > 0);

    if (hasAny) selected.push(provider);
    else missing.push({ provider, keys });
  }

  return { selected, missing };
}

export function assertProviderEnv(providers, dryRun) {
  const { missing } = filterProvidersWithEnv(providers, dryRun);
  if (missing.length === 0) return;

  throw new Error(
    `Missing provider credentials for: ${missing.map(({ provider, keys }) => `${provider}(${keys.join('|')})`).join(', ')}. See .env.test-batch.example.`,
  );
}

export function tailCollector(maxLines = Number(process.env.BATCH_LOG_TAIL_LINES ?? 40)) {
  const lines = [];

  return {
    push(chunk) {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        lines.push(line);
        if (lines.length > maxLines) lines.shift();
      }
    },
    text() {
      return lines.join('\n');
    },
  };
}

export function stageMarkdown(report) {
  return [
    `# Batch Stage Report — ${report.stageId}`,
    '',
    `- Status: **${report.status.toUpperCase()}**`,
    `- Exit code: ${report.exitCode ?? 'n/a'}`,
    `- Duration: ${report.durationMs}ms`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Command: \`${report.command.join(' ')}\``,
    `- Stdout log: ${report.logs.stdout}`,
    `- Stderr log: ${report.logs.stderr}`,
    `- Lane artifacts root: ${report.artifacts.laneArtifactsRoot}`,
    `- Lane results path: ${report.artifacts.laneResultsPath}`,
    report.errorExcerpt ? `- Error excerpt: ${report.errorExcerpt}` : '',
    report.notRunReason ? `- Not run reason: ${report.notRunReason}` : '',
    report.status === 'skipped'
      ? '- Evidence placeholders: generated for claimed log/artifact paths.'
      : '',
    report.skip?.detail ? `- Skip detail: ${report.skip.detail}` : '',
    report.skip?.missingCredentialKeys?.length
      ? `- Missing credential keys: ${report.skip.missingCredentialKeys.join(', ')}`
      : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function summaryMarkdown(summary) {
  const skippedProviders = summary.skippedProviders ?? [];
  const skippedProviderList = skippedProviders.map(({ provider }) => provider);

  const lines = [
    `# Batch Test Summary — ${summary.runId}`,
    '',
    `- Mode: ${summary.mode}`,
    `- Failure policy: ${summary.failurePolicy}`,
    `- Requested providers: ${(summary.requestedProviders ?? []).join(', ') || 'none'}`,
    `- Active providers: ${(summary.providers ?? []).join(', ') || 'none'}`,
    skippedProviders.length > 0
      ? `- Skipped providers (missing credentials): ${skippedProviderList.join(', ')}`
      : '- Skipped providers (missing credentials): none',
    `- Dry run: ${summary.dryRun}`,
    `- Final exit code: ${summary.finalExitCode}`,
    `- Duration: ${summary.durationMs}ms`,
    `- Totals: pass=${summary.stageTotals.pass}, fail=${summary.stageTotals.fail}, infraFail=${summary.stageTotals.infraFail}, skipped=${summary.stageTotals.skipped}`,
    summary.artifacts?.runManifestPath
      ? `- Run manifest: ${summary.artifacts.runManifestPath}`
      : '',
    summary.artifacts?.summaryJsonPath
      ? `- Summary JSON: ${summary.artifacts.summaryJsonPath}`
      : '',
    summary.artifacts?.summaryMarkdownPath
      ? `- Summary Markdown: ${summary.artifacts.summaryMarkdownPath}`
      : '',
    '',
    '| Stage | Status | Exit | Duration(ms) | Not run reason |',
    '|---|---:|---:|---:|---|',
  ];

  for (const stage of summary.stages) {
    lines.push(
      `| ${stage.stageId} | ${stage.status} | ${stage.exitCode ?? ''} | ${stage.durationMs} | ${stage.notRunReason ?? ''} |`,
    );
  }

  return lines.join('\n') + '\n';
}
