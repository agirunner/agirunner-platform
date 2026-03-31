import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Trash2 } from 'lucide-react';

import { dashboardApi, type DashboardWorkspaceArtifactFileRecord } from '../../../lib/api.js';
import { fileToBase64 } from '../../../lib/file-upload.js';
import { Button } from '../../../components/ui/button.js';
import { toast } from '../../../lib/toast.js';

export function WorkspaceArtifactFilesPanel(props: { workspaceId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const fileInputId = useId();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [downloadTargetId, setDownloadTargetId] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ['workspace-artifact-files', props.workspaceId],
    queryFn: () => dashboardApi.listWorkspaceArtifactFiles(props.workspaceId),
  });

  const uploadMutation = useMutation({
    mutationFn: async (selectedFiles: File[]) => {
      const payload = await buildArtifactUploadPayloads(
        selectedFiles,
        (filesQuery.data ?? []).map((file) => file.key),
      );
      return dashboardApi.uploadWorkspaceArtifactFiles(props.workspaceId, payload);
    },
    onSuccess: async () => {
      setUploadError(null);
      await queryClient.invalidateQueries({
        queryKey: ['workspace-artifact-files', props.workspaceId],
      });
      toast.success('Workspace artifacts uploaded.');
    },
    onError: (error) => {
      setUploadError(readErrorMessage(error, 'Failed to upload workspace artifacts.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) =>
      dashboardApi.deleteWorkspaceArtifactFile(props.workspaceId, fileId),
    onSuccess: async () => {
      setDeleteTargetId(null);
      await queryClient.invalidateQueries({
        queryKey: ['workspace-artifact-files', props.workspaceId],
      });
      toast.success('Workspace artifact deleted.');
    },
    onError: (error) => {
      toast.error(readErrorMessage(error, 'Failed to delete workspace artifact.'));
      setDeleteTargetId(null);
    },
  });

  function handleFilesSelected(fileList: FileList | null): void {
    const selectedFiles = snapshotSelectedFiles(fileList);
    if (selectedFiles.length === 0) {
      return;
    }
    setUploadError(null);
    uploadMutation.mutate(selectedFiles);
  }

  return (
    <div className="space-y-4">
      <input
        id={fileInputId}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          handleFilesSelected(event.target.files);
          event.currentTarget.value = '';
        }}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" asChild>
          <label htmlFor={fileInputId} className="cursor-pointer">
            <FileUp className="h-4 w-4" />
            Add files
          </label>
        </Button>
      </div>

      {uploadError ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          {uploadError}
        </p>
      ) : null}

      {uploadMutation.isPending ? (
        <p className="text-sm text-muted">Uploading workspace artifacts…</p>
      ) : null}

      {filesQuery.isLoading ? (
        <p className="text-sm text-muted">Loading workspace artifacts…</p>
      ) : filesQuery.error ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          Failed to load workspace artifacts.
        </p>
      ) : filesQuery.data && filesQuery.data.length > 0 ? (
        <div className="space-y-3">
          {filesQuery.data.map((file) => (
            <ExistingArtifactRow
              key={file.id}
              file={file}
              isDeleting={deleteMutation.isPending && deleteTargetId === file.id}
              isDownloading={downloadTargetId === file.id}
              onDownload={async () => {
                setDownloadTargetId(file.id);
                try {
                  const download = await dashboardApi.downloadWorkspaceArtifactFile(
                    props.workspaceId,
                    file.id,
                  );
                  const objectUrl = URL.createObjectURL(download.blob);
                  const link = document.createElement('a');
                  link.href = objectUrl;
                  link.download = download.file_name ?? file.file_name;
                  document.body.append(link);
                  link.click();
                  link.remove();
                  URL.revokeObjectURL(objectUrl);
                } catch (error) {
                  toast.error(readErrorMessage(error, 'Failed to download workspace artifact.'));
                } finally {
                  setDownloadTargetId(null);
                }
              }}
              onDelete={() => {
                setDeleteTargetId(file.id);
                deleteMutation.mutate(file.id);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted">
          No workspace artifacts uploaded yet.
        </p>
      )}
    </div>
  );
}

function ExistingArtifactRow(props: {
  file: DashboardWorkspaceArtifactFileRecord;
  isDeleting: boolean;
  isDownloading: boolean;
  onDownload(): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 bg-background/80 p-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{props.file.file_name}</p>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted">
            {props.file.key}
          </span>
        </div>
        {props.file.description ? (
          <p className="text-sm leading-6 text-muted">{props.file.description}</p>
        ) : null}
        <p className="text-xs text-muted">
          {formatFileSize(props.file.size_bytes)} •{' '}
          {new Date(props.file.created_at).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isDownloading || props.isDeleting}
          onClick={props.onDownload}
        >
          <Download className="h-4 w-4" />
          Download file
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isDeleting || props.isDownloading}
          onClick={props.onDelete}
        >
          <Trash2 className="h-4 w-4" />
          Delete file
        </Button>
      </div>
    </div>
  );
}

export function snapshotSelectedFiles(fileList: FileList | null): File[] {
  if (!fileList || fileList.length === 0) {
    return [];
  }

  const files: File[] = [];
  for (let index = 0; index < fileList.length; index += 1) {
    const file = fileList.item(index);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function buildUniqueArtifactKey(fileName: string, reservedKeys: Set<string>): string {
  const baseKey =
    fileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file';

  if (!reservedKeys.has(baseKey)) {
    return baseKey;
  }

  let index = 2;
  while (reservedKeys.has(`${baseKey}-${index}`)) {
    index += 1;
  }
  return `${baseKey}-${index}`;
}

export async function buildArtifactUploadPayloads(
  files: File[],
  existingKeys: string[],
): Promise<
  Array<{
    key: string;
    description: string;
    file_name: string;
    content_base64: string;
    content_type?: string;
  }>
> {
  const reservedKeys = new Set(existingKeys.map((key) => key.trim().toLowerCase()));

  return Promise.all(
    files.map(async (file) => {
      const key = buildUniqueArtifactKey(file.name, reservedKeys);
      reservedKeys.add(key.toLowerCase());
      return {
        key,
        description: '',
        file_name: file.name,
        content_base64: await fileToBase64(file),
        content_type: file.type || undefined,
      };
    }),
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
