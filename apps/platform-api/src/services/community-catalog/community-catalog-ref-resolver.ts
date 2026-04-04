import type { ContainerManagerVersionReader } from '../system-version/container-manager-version-reader.js';

export const DEFAULT_COMMUNITY_CATALOG_REF = 'main';

const RELEASE_VERSION_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export class CommunityCatalogRefResolver {
  constructor(private readonly deps: {
    configuredRef?: string;
    versionReader: Pick<ContainerManagerVersionReader, 'getSummary'>;
  }) {}

  async resolveRef(): Promise<string> {
    const configuredRef = readTrimmedValue(this.deps.configuredRef);
    if (configuredRef) {
      return configuredRef;
    }

    try {
      const summary = await this.deps.versionReader.getSummary();
      return deriveCommunityCatalogRef(summary.platform_api?.version);
    } catch {
      return DEFAULT_COMMUNITY_CATALOG_REF;
    }
  }
}

export function deriveCommunityCatalogRef(platformVersion?: string | null): string {
  const normalizedPlatformVersion = readTrimmedValue(platformVersion);
  if (!normalizedPlatformVersion || !RELEASE_VERSION_PATTERN.test(normalizedPlatformVersion)) {
    return DEFAULT_COMMUNITY_CATALOG_REF;
  }
  return normalizedPlatformVersion.startsWith('v')
    ? normalizedPlatformVersion
    : `v${normalizedPlatformVersion}`;
}

function readTrimmedValue(value?: string | null): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : null;
}
