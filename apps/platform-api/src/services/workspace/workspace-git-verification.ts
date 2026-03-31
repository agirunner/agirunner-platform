import { isExternalSecretReference, readProviderSecret } from '../../lib/oauth-crypto.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { normalizeWorkspaceSettings } from '../workspace-settings.js';
import type {
  VerifyWorkspaceGitAccessInput,
  WorkspaceRow,
} from './workspace-types.js';

export function resolveWorkspaceGitVerificationToken(
  workspace: WorkspaceRow,
  input: VerifyWorkspaceGitAccessInput,
): string | null {
  if (input.git_token_mode === 'clear') {
    return null;
  }

  if (input.git_token_mode === 'replace') {
    const replacement = typeof input.git_token === 'string' ? input.git_token.trim() : '';
    if (!replacement) {
      throw new ValidationError('Git token is required when replacing repository access.');
    }
    if (isExternalSecretReference(replacement)) {
      throw new ValidationError(
        'Git access verification cannot use external secret references. Enter the concrete token value before saving.',
      );
    }
    return readWorkspaceGitVerificationSecret(
      replacement,
      'Git token could not be read for verification. Enter the token again before saving.',
    );
  }

  const settings = normalizeWorkspaceSettings(workspace.settings);
  const storedGitToken = settings.credentials.git_token ?? null;
  if (!storedGitToken) {
    return null;
  }
  if (isExternalSecretReference(storedGitToken)) {
    throw new ValidationError(
      'The stored Git token uses an external secret reference and cannot be reverified on save. Replace the token before changing the repository.',
    );
  }
  return readWorkspaceGitVerificationSecret(
    storedGitToken,
    'Stored Git token could not be read for verification. Replace the token before changing the repository.',
  );
}

function readWorkspaceGitVerificationSecret(secret: string, message: string): string {
  try {
    return readProviderSecret(secret);
  } catch {
    throw new ValidationError(message);
  }
}
