import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageConfig } from './storage-factory.js';

export const DEFAULT_ARTIFACT_CONTENT_TYPE = 'application/octet-stream';

export function buildArtifactStorageConfig(env: AppEnv): ArtifactStorageConfig {
  return {
    backend: env.ARTIFACT_STORAGE_BACKEND,
    localRoot: env.ARTIFACT_LOCAL_ROOT,
    s3:
      env.ARTIFACT_STORAGE_BACKEND === 's3'
        ? {
            bucket: env.ARTIFACT_S3_BUCKET!,
            region: env.ARTIFACT_S3_REGION,
            endpoint: env.ARTIFACT_S3_ENDPOINT,
            forcePathStyle: env.ARTIFACT_S3_FORCE_PATH_STYLE,
            accessKeyId: env.ARTIFACT_S3_ACCESS_KEY_ID!,
            secretAccessKey: env.ARTIFACT_S3_SECRET_ACCESS_KEY!,
            sessionToken: env.ARTIFACT_S3_SESSION_TOKEN,
          }
        : undefined,
  };
}
