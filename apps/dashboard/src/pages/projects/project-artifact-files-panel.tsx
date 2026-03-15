import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Trash2, Upload, X } from 'lucide-react';

import {
  dashboardApi,
  type DashboardProjectArtifactFileRecord,
} from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { toast } from '../../lib/toast.js';

interface ArtifactUploadDraft {
  id: string;
  file: File;
  key: string;
  description: string;
}

export function ProjectArtifactFilesPanel(props: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const fileInputId = useId();
  const [drafts, setDrafts] = useState<ArtifactUploadDraft[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const filesQuery = useQuery({
    queryKey: ['project-artifact-files', props.projectId],
    queryFn: () => dashboardApi.listProjectArtifactFiles(props.projectId),
  });

  const draftErrors = useMemo(
    () => validateDrafts(drafts, filesQuery.data ?? []),
    [drafts, filesQuery.data],
  );
  const hasDraftErrors = draftErrors.some(Boolean);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const normalizedDrafts = await Promise.all(drafts.map(async (draft) => ({
        key: draft.key.trim(),
        description: draft.description.trim(),
        file_name: draft.file.name,
        content_base64: await fileToBase64(draft.file),
        content_type: draft.file.type || undefined,
      })));
      return dashboardApi.uploadProjectArtifactFiles(props.projectId, normalizedDrafts);
    },
    onSuccess: async () => {
      setDrafts([]);
      setUploadError(null);
      await queryClient.invalidateQueries({ queryKey: ['project-artifact-files', props.projectId] });
      toast.success('Project artifacts uploaded.');
    },
    onError: (error) => {
      setUploadError(readErrorMessage(error, 'Failed to upload project artifacts.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => dashboardApi.deleteProjectArtifactFile(props.projectId, fileId),
    onSuccess: async () => {
      setDeleteTargetId(null);
      await queryClient.invalidateQueries({ queryKey: ['project-artifact-files', props.projectId] });
      toast.success('Project artifact deleted.');
    },
    onError: (error) => {
      toast.error(readErrorMessage(error, 'Failed to delete project artifact.'));
      setDeleteTargetId(null);
    },
  });

  function handleFilesSelected(fileList: FileList | null): void {
    if (!fileList || fileList.length === 0) {
      return;
    }
    setUploadError(null);
    setDrafts((current) => appendDrafts(current, Array.from(fileList), filesQuery.data ?? []));
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">Upload project artifacts</h3>
            <p className="max-w-3xl text-sm leading-6 text-muted">
              Upload one or many project files here. Keys default from file names, descriptions stay optional, and everything remains scoped to this project.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button type="button" variant="outline" asChild>
              <label htmlFor={fileInputId} className="cursor-pointer">
                <FileUp className="h-4 w-4" />
                Add files
              </label>
            </Button>
            <Button
              type="button"
              disabled={drafts.length === 0 || hasDraftErrors || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
            >
              <Upload className="h-4 w-4" />
              Upload files
            </Button>
          </div>
        </div>

        {drafts.length > 0 ? (
          <div className="space-y-3 border-t border-border/70 pt-3">
            {drafts.map((draft, index) => (
              <div key={draft.id} className="rounded-xl border border-border/70 bg-background/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{draft.file.name}</p>
                    <p className="text-xs text-muted">{formatFileSize(draft.file.size)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDrafts((current) => current.filter((entry) => entry.id !== draft.id))
                    }
                    aria-label={`Remove ${draft.file.name}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted" htmlFor={`${draft.id}-key`}>
                      Key
                    </label>
                    <Input
                      id={`${draft.id}-key`}
                      value={draft.key}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((entry) =>
                            entry.id === draft.id ? { ...entry, key: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium text-muted"
                      htmlFor={`${draft.id}-description`}
                    >
                      Description
                    </label>
                    <Input
                      id={`${draft.id}-description`}
                      value={draft.description}
                      placeholder="Optional description"
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((entry) =>
                            entry.id === draft.id
                              ? { ...entry, description: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </div>
                </div>

                {draftErrors[index] ? (
                  <p className="mt-2 text-sm text-red-700 dark:text-red-300">{draftErrors[index]}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted">
            No files queued yet.
          </p>
        )}

        {uploadError ? (
          <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
            {uploadError}
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-border/70 bg-card/70 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">Project artifacts</h3>
          <p className="text-sm leading-6 text-muted">
            Curated project-owned files stay here. Delete anything that should no longer be available to this project.
          </p>
        </div>

        {filesQuery.isLoading ? (
          <p className="text-sm text-muted">Loading project artifacts…</p>
        ) : filesQuery.error ? (
          <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
            Failed to load project artifacts.
          </p>
        ) : filesQuery.data && filesQuery.data.length > 0 ? (
          <div className="space-y-3">
            {filesQuery.data.map((file) => (
              <ExistingArtifactRow
                key={file.id}
                file={file}
                isDeleting={deleteMutation.isPending && deleteTargetId === file.id}
                onDelete={() => {
                  setDeleteTargetId(file.id);
                  deleteMutation.mutate(file.id);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted">
            No project artifacts uploaded yet.
          </p>
        )}
      </section>
    </div>
  );
}

function ExistingArtifactRow(props: {
  file: DashboardProjectArtifactFileRecord;
  isDeleting: boolean;
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
          {formatFileSize(props.file.size_bytes)} • {new Date(props.file.created_at).toLocaleString()}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={props.isDeleting}
        onClick={props.onDelete}
      >
        <Trash2 className="h-4 w-4" />
        Delete file
      </Button>
    </div>
  );
}

function appendDrafts(
  currentDrafts: ArtifactUploadDraft[],
  files: File[],
  existingFiles: DashboardProjectArtifactFileRecord[],
): ArtifactUploadDraft[] {
  const nextDrafts = [...currentDrafts];
  const reservedKeys = new Set([
    ...existingFiles.map((file) => file.key.toLowerCase()),
    ...currentDrafts.map((draft) => draft.key.trim().toLowerCase()),
  ]);

  for (const file of files) {
    const key = buildUniqueArtifactKey(file.name, reservedKeys);
    reservedKeys.add(key.toLowerCase());
    nextDrafts.push({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file,
      key,
      description: '',
    });
  }

  return nextDrafts;
}

function buildUniqueArtifactKey(fileName: string, reservedKeys: Set<string>): string {
  const baseKey = fileName
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

function validateDrafts(
  drafts: ArtifactUploadDraft[],
  existingFiles: DashboardProjectArtifactFileRecord[],
): Array<string | null> {
  const counts = new Map<string, number>();
  const existingKeys = new Set(existingFiles.map((file) => file.key.trim().toLowerCase()));

  for (const draft of drafts) {
    const normalizedKey = draft.key.trim().toLowerCase();
    counts.set(normalizedKey, (counts.get(normalizedKey) ?? 0) + 1);
  }

  return drafts.map((draft) => {
    const key = draft.key.trim();
    const normalizedKey = key.toLowerCase();
    if (!key) {
      return 'Enter a key before uploading.';
    }
    if (key.length > 120) {
      return 'Key must be 120 characters or fewer.';
    }
    if (existingKeys.has(normalizedKey)) {
      return 'This key already exists for the project.';
    }
    if ((counts.get(normalizedKey) ?? 0) > 1) {
      return 'Each queued file needs a unique key.';
    }
    if (draft.description.trim().length > 2000) {
      return 'Description must be 2000 characters or fewer.';
    }
    return null;
  });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(bytes));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
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
