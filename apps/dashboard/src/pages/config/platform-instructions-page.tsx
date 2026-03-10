import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MonacoEditor from '@monaco-editor/react';

const Editor = MonacoEditor as unknown as React.ComponentType<{
  height: string;
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  options?: Record<string, unknown>;
}>;
import { Loader2, Save, FileText, History } from 'lucide-react';
import { DiffViewer } from '../../components/diff-viewer.js';
import { readSession } from '../../lib/session.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/card.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

interface PlatformInstructions {
  content: string;
  version?: number;
  updated_at?: string;
}

async function fetchInstructions(): Promise<PlatformInstructions> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/instructions`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (typeof body === 'string') {
    return { content: body };
  }
  return body.data ?? body;
}

async function saveInstructions(
  content: string,
): Promise<PlatformInstructions> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/instructions`, {
    method: 'PUT',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

export function PlatformInstructionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editorContent, setEditorContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [previousVersions, setPreviousVersions] = useState<string[]>([]);
  const [isDiffOpen, setIsDiffOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-instructions'],
    queryFn: fetchInstructions,
  });

  useEffect(() => {
    if (data?.content !== undefined) {
      setEditorContent(data.content);
      setHasUnsavedChanges(false);
    }
  }, [data?.content]);

  const mutation = useMutation({
    mutationFn: () => saveInstructions(editorContent),
    onSuccess: (updated) => {
      if (data?.content) {
        setPreviousVersions((prev) => [...prev, data.content]);
      }
      queryClient.setQueryData(['platform-instructions'], updated);
      setHasUnsavedChanges(false);
    },
  });

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      setEditorContent(next);
      setHasUnsavedChanges(next !== (data?.content ?? ''));
    },
    [data?.content],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load platform instructions: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform Instructions</h1>
          <p className="text-sm text-muted">
            System-level instructions applied to all agent interactions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.version !== undefined && (
            <span className="text-xs text-muted">
              Version {data.version}
            </span>
          )}
          {data?.updated_at && (
            <span className="text-xs text-muted">
              Last saved {new Date(data.updated_at).toLocaleString()}
            </span>
          )}
          {previousVersions.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDiffOpen(!isDiffOpen)}
            >
              <History className="h-4 w-4" />
              {isDiffOpen ? 'Hide Diff' : 'Show Diff'}
            </Button>
          )}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !hasUnsavedChanges}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>

      {mutation.isSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Platform instructions saved successfully.
        </div>
      )}

      {mutation.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to save: {String(mutation.error)}
        </div>
      )}

      {editorContent.length === 0 && !hasUnsavedChanges ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <FileText className="h-12 w-12 mb-4" />
          <p className="font-medium">No platform instructions set</p>
          <p className="text-sm mt-1">
            Start typing below to define global agent instructions.
          </p>
        </div>
      ) : null}

      {isDiffOpen && previousVersions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Version History Diff
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DiffViewer
              oldText={previousVersions[previousVersions.length - 1]}
              newText={data?.content ?? ''}
              oldLabel="Previous Version"
              newLabel="Current Version"
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Instructions Editor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border border-border rounded-lg overflow-hidden">
            <Editor
              height="400px"
              language="markdown"
              value={editorContent}
              onChange={handleContentChange}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </div>
        </CardContent>
      </Card>

      {hasUnsavedChanges && (
        <p className="text-xs text-yellow-600">You have unsaved changes.</p>
      )}
    </div>
  );
}
