import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, FileText } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
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
  const response = await fetch(`${API_BASE_URL}/api/v1/platform-instructions`, {
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
  const response = await fetch(`${API_BASE_URL}/api/v1/platform-instructions`, {
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
      queryClient.setQueryData(['platform-instructions'], updated);
      setHasUnsavedChanges(false);
    },
  });

  function handleContentChange(value: string) {
    setEditorContent(value);
    setHasUnsavedChanges(value !== (data?.content ?? ''));
  }

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Instructions Editor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={editorContent}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Enter platform instructions for all agents..."
            className="min-h-[400px] font-mono text-sm"
            spellCheck={false}
          />
        </CardContent>
      </Card>

      {hasUnsavedChanges && (
        <p className="text-xs text-yellow-600">You have unsaved changes.</p>
      )}
    </div>
  );
}
