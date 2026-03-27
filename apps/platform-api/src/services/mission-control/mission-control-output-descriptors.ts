import type {
  MissionControlOutputDescriptor,
  MissionControlOutputLocation,
  MissionControlOutputStatus,
} from './mission-control-types.js';

export type MissionControlOutputDescriptorInput =
  | {
      kind: 'artifact';
      id: string;
      artifactId: string;
      taskId: string;
      logicalPath: string;
      status: MissionControlOutputStatus;
      contentType?: string | null;
      previewPath?: string | null;
      downloadPath?: string | null;
      title?: string | null;
      summary?: string | null;
      producedByRole?: string | null;
      workItemId?: string | null;
      stageName?: string | null;
    }
  | {
      kind: 'repository';
      id: string;
      repository: string;
      status: MissionControlOutputStatus;
      branch?: string | null;
      branchUrl?: string | null;
      commitSha?: string | null;
      commitUrl?: string | null;
      pullRequestUrl?: string | null;
      title?: string | null;
      summary?: string | null;
      producedByRole?: string | null;
      workItemId?: string | null;
      taskId?: string | null;
      stageName?: string | null;
    }
  | {
      kind: 'host_directory';
      id: string;
      path: string;
      status: MissionControlOutputStatus;
      title?: string | null;
      summary?: string | null;
      producedByRole?: string | null;
      workItemId?: string | null;
      taskId?: string | null;
      stageName?: string | null;
    }
  | {
      kind: 'workflow_document';
      id: string;
      workflowId: string;
      documentId: string;
      logicalName: string;
      source: 'repository' | 'artifact' | 'external';
      location: string;
      artifactId?: string | null;
      status: MissionControlOutputStatus;
      title?: string | null;
      summary?: string | null;
      producedByRole?: string | null;
      workItemId?: string | null;
      taskId?: string | null;
      stageName?: string | null;
    }
  | {
      kind: 'external_url';
      id: string;
      url: string;
      status: MissionControlOutputStatus;
      title?: string | null;
      summary?: string | null;
      producedByRole?: string | null;
      workItemId?: string | null;
      taskId?: string | null;
      stageName?: string | null;
    };

export function composeMissionControlOutputDescriptor(
  input: MissionControlOutputDescriptorInput,
): MissionControlOutputDescriptor {
  const primaryLocation = composePrimaryLocation(input);
  return {
    id: input.id,
    title: readDescriptorTitle(input),
    summary: input.summary ?? null,
    status: input.status,
    producedByRole: input.producedByRole ?? null,
    workItemId: input.workItemId ?? null,
    taskId: input.taskId ?? null,
    stageName: input.stageName ?? null,
    primaryLocation,
    secondaryLocations: composeSecondaryLocations(input),
  };
}

function composePrimaryLocation(
  input: MissionControlOutputDescriptorInput,
): MissionControlOutputLocation {
  switch (input.kind) {
    case 'artifact':
      return {
        kind: 'artifact',
        artifactId: input.artifactId,
        taskId: input.taskId,
        logicalPath: input.logicalPath,
        previewPath: input.previewPath ?? `/artifacts/tasks/${input.taskId}/${input.artifactId}`,
        downloadPath:
          input.downloadPath ?? `/api/v1/tasks/${input.taskId}/artifacts/${input.artifactId}`,
        contentType: input.contentType ?? null,
      };
    case 'repository':
      return {
        kind: 'repository',
        repository: input.repository,
        branch: input.branch ?? null,
        branchUrl: input.branchUrl ?? null,
        commitSha: input.commitSha ?? null,
        commitUrl: input.commitUrl ?? null,
        pullRequestUrl: input.pullRequestUrl ?? null,
      };
    case 'host_directory':
      return {
        kind: 'host_directory',
        path: input.path,
      };
    case 'workflow_document':
      return {
        kind: 'workflow_document',
        workflowId: input.workflowId,
        documentId: input.documentId,
        logicalName: input.logicalName,
        source: input.source,
        location: input.location,
        artifactId: input.artifactId ?? null,
      };
    case 'external_url':
      return {
        kind: 'external_url',
        url: input.url,
      };
  }
}

function readDescriptorTitle(input: MissionControlOutputDescriptorInput): string {
  if (input.title && input.title.trim().length > 0) {
    return input.title.trim();
  }
  if (input.kind === 'artifact') {
    return input.logicalPath;
  }
  if (input.kind === 'workflow_document') {
    return input.logicalName;
  }
  if (input.kind === 'host_directory') {
    return input.path;
  }
  if (input.kind === 'external_url') {
    return input.url;
  }
  return input.repository;
}

function composeSecondaryLocations(
  input: MissionControlOutputDescriptorInput,
): MissionControlOutputLocation[] {
  if (input.kind === 'workflow_document' && input.source === 'external') {
    return [
      {
        kind: 'external_url',
        url: input.location,
      },
    ];
  }
  return [];
}
