import { existsSync, readFileSync, statSync } from 'node:fs';

interface ArtifactExpectation {
  path: string;
  requiredKeys?: string[];
}

export function verifyArtifacts(expectations: ArtifactExpectation[]): string[] {
  const validations: string[] = [];

  for (const artifact of expectations) {
    if (!existsSync(artifact.path)) {
      throw new Error(`Missing artifact: ${artifact.path}`);
    }

    const stats = statSync(artifact.path);
    if (!stats.isFile()) {
      throw new Error(`Artifact is not a file: ${artifact.path}`);
    }
    if (stats.size === 0) {
      throw new Error(`Artifact is empty: ${artifact.path}`);
    }

    if (artifact.requiredKeys && artifact.requiredKeys.length > 0) {
      const raw = readFileSync(artifact.path, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of artifact.requiredKeys) {
        if (!(key in parsed)) {
          throw new Error(`Artifact ${artifact.path} missing required key: ${key}`);
        }
      }
      validations.push(`artifact_schema:${artifact.path}`);
    }

    validations.push(`artifact:${artifact.path}`);
  }

  return validations;
}
