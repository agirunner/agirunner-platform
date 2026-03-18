import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageConfig } from './storage-factory.js';

export const DEFAULT_ARTIFACT_CONTENT_TYPE = 'application/octet-stream';

export type ArtifactStorageEnv = Partial<
  Pick<
    AppEnv,
    | 'ARTIFACT_STORAGE_BACKEND'
    | 'ARTIFACT_LOCAL_ROOT'
    | 'ARTIFACT_S3_BUCKET'
    | 'ARTIFACT_S3_REGION'
    | 'ARTIFACT_S3_ENDPOINT'
    | 'ARTIFACT_S3_FORCE_PATH_STYLE'
    | 'ARTIFACT_S3_ACCESS_KEY_ID'
    | 'ARTIFACT_S3_SECRET_ACCESS_KEY'
    | 'ARTIFACT_S3_SESSION_TOKEN'
    | 'ARTIFACT_GCS_BUCKET'
    | 'ARTIFACT_GCS_PROJECT_ID'
    | 'ARTIFACT_GCS_KEY_FILE'
    | 'ARTIFACT_GCS_CREDENTIALS_JSON'
    | 'ARTIFACT_AZURE_ACCOUNT_NAME'
    | 'ARTIFACT_AZURE_CONTAINER'
    | 'ARTIFACT_AZURE_CONNECTION_STRING'
    | 'ARTIFACT_AZURE_ACCOUNT_KEY'
  >
>;

export function buildArtifactStorageConfig(env: ArtifactStorageEnv): ArtifactStorageConfig {
  return {
    backend: env.ARTIFACT_STORAGE_BACKEND ?? 'local',
    localRoot: env.ARTIFACT_LOCAL_ROOT ?? '/tmp/agirunner-platform-artifacts',
    s3:
      env.ARTIFACT_STORAGE_BACKEND === 's3'
        ? {
            bucket: env.ARTIFACT_S3_BUCKET!,
            region: env.ARTIFACT_S3_REGION ?? 'us-east-1',
            endpoint: env.ARTIFACT_S3_ENDPOINT,
            forcePathStyle: env.ARTIFACT_S3_FORCE_PATH_STYLE ?? true,
            accessKeyId: env.ARTIFACT_S3_ACCESS_KEY_ID!,
            secretAccessKey: env.ARTIFACT_S3_SECRET_ACCESS_KEY!,
            sessionToken: env.ARTIFACT_S3_SESSION_TOKEN,
          }
        : undefined,
    gcs:
      env.ARTIFACT_STORAGE_BACKEND === 'gcs'
        ? {
            bucket: env.ARTIFACT_GCS_BUCKET!,
            projectId: env.ARTIFACT_GCS_PROJECT_ID,
            keyFilename: env.ARTIFACT_GCS_KEY_FILE,
            credentialsJson: env.ARTIFACT_GCS_CREDENTIALS_JSON,
          }
        : undefined,
    azure:
      env.ARTIFACT_STORAGE_BACKEND === 'azure'
        ? {
            accountName: env.ARTIFACT_AZURE_ACCOUNT_NAME!,
            container: env.ARTIFACT_AZURE_CONTAINER!,
            connectionString: env.ARTIFACT_AZURE_CONNECTION_STRING,
            accountKey: env.ARTIFACT_AZURE_ACCOUNT_KEY,
          }
        : undefined,
  };
}
