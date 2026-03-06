import fs from 'node:fs';

export interface SecretBinding {
  envName: string;
  fileEnvName?: string;
  required?: boolean;
  minLength?: number;
  requireFileInProduction?: boolean;
}

function formatSourceHint(binding: SecretBinding): string {
  const fileEnvName = binding.fileEnvName ?? `${binding.envName}_FILE`;
  return `${binding.envName} or ${fileEnvName}`;
}

function readSecretFile(filePath: string, envName: string, fileEnvName: string): string {
  let secretValue: string;
  try {
    secretValue = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${fileEnvName} for ${envName}: ${String(error)}`);
  }

  const trimmed = secretValue.trim();
  if (!trimmed) {
    throw new Error(`${fileEnvName} for ${envName} resolved to an empty file.`);
  }

  return trimmed;
}

export function resolveSecretEnv(
  source: NodeJS.ProcessEnv,
  bindings: SecretBinding[],
  target: NodeJS.ProcessEnv = source,
): NodeJS.ProcessEnv {
  const nodeEnv = source.NODE_ENV ?? target.NODE_ENV ?? 'development';

  for (const binding of bindings) {
    const fileEnvName = binding.fileEnvName ?? `${binding.envName}_FILE`;
    const inlineValue = source[binding.envName]?.trim();
    const filePath = source[fileEnvName]?.trim();

    let resolvedValue = inlineValue;

    if (filePath) {
      const fileValue = readSecretFile(filePath, binding.envName, fileEnvName);
      if (inlineValue && inlineValue !== fileValue) {
        throw new Error(`${binding.envName} and ${fileEnvName} must match when both are set.`);
      }
      resolvedValue = fileValue;
      target[binding.envName] = fileValue;
    } else if (resolvedValue) {
      target[binding.envName] = resolvedValue;
    } else {
      delete target[binding.envName];
    }

    const expectsConfiguredValue = binding.required || Boolean(inlineValue);
    if (binding.requireFileInProduction && nodeEnv === 'production' && expectsConfiguredValue && !filePath) {
      throw new Error(`${fileEnvName} is required for ${binding.envName} when NODE_ENV=production.`);
    }

    if (binding.required && !resolvedValue) {
      throw new Error(`Missing required secret ${formatSourceHint(binding)}.`);
    }

    if (resolvedValue && binding.minLength && resolvedValue.length < binding.minLength) {
      throw new Error(`${binding.envName} must be at least ${binding.minLength} characters long.`);
    }
  }

  return target;
}
