import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Upload } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs.js';
import type { TemplateDefinition } from './template-editor-types.js';
import { fetchTemplate, saveTemplateDraft, publishTemplate } from './template-editor-api.js';
import { VisualTab } from './template-editor-visual-tab.js';
import { CodeTab } from './template-editor-code-tab.js';
import { VariablesTab } from './template-editor-variables-tab.js';
import { ConfigPolicyTab } from './template-editor-config-policy-tab.js';
import { LifecycleTab } from './template-editor-lifecycle-tab.js';
import { PreviewTab } from './template-editor-preview-tab.js';

export function TemplateEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [localTemplate, setLocalTemplate] = useState<TemplateDefinition | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['template', id],
    queryFn: () => fetchTemplate(id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (data) {
      setLocalTemplate(data);
      setHasUnsavedChanges(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => saveTemplateDraft(localTemplate!),
    onSuccess: (saved) => {
      queryClient.setQueryData(['template', id], saved);
      setHasUnsavedChanges(false);
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishTemplate(localTemplate!),
    onSuccess: (published) => {
      queryClient.setQueryData(['template', id], published);
      setHasUnsavedChanges(false);
    },
  });

  const handleChange = useCallback(
    (updated: TemplateDefinition) => {
      setLocalTemplate(updated);
      setHasUnsavedChanges(true);
    },
    [],
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
          Failed to load template: {String(error)}
        </div>
      </div>
    );
  }

  if (!localTemplate) {
    return (
      <div className="p-6 text-muted text-sm">Template not found.</div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <TemplateEditorHeader
        template={localTemplate}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={saveMutation.isPending}
        isPublishing={publishMutation.isPending}
        onSave={() => saveMutation.mutate()}
        onPublish={() => publishMutation.mutate()}
      />

      <MutationFeedback
        saveError={saveMutation.error}
        publishError={publishMutation.error}
        isSaveSuccess={saveMutation.isSuccess}
        isPublishSuccess={publishMutation.isSuccess}
      />

      {hasUnsavedChanges && (
        <p className="text-xs text-yellow-600">You have unsaved changes.</p>
      )}

      <Tabs defaultValue="visual">
        <TabsList>
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
          <TabsTrigger value="config-policy">Config Policy</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="visual">
          <VisualTab template={localTemplate} onChange={handleChange} />
        </TabsContent>
        <TabsContent value="code">
          <CodeTab template={localTemplate} onChange={handleChange} />
        </TabsContent>
        <TabsContent value="variables">
          <VariablesTab template={localTemplate} onChange={handleChange} />
        </TabsContent>
        <TabsContent value="config-policy">
          <ConfigPolicyTab template={localTemplate} onChange={handleChange} />
        </TabsContent>
        <TabsContent value="lifecycle">
          <LifecycleTab template={localTemplate} onChange={handleChange} />
        </TabsContent>
        <TabsContent value="preview">
          <PreviewTab template={localTemplate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface HeaderProps {
  template: TemplateDefinition;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => void;
  onPublish: () => void;
}

function TemplateEditorHeader({
  template,
  hasUnsavedChanges,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: HeaderProps): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">
          {template.name || 'Untitled Template'}
        </h1>
        <p className="text-sm text-muted">
          {template.slug || 'template-editor'} &middot; v{template.version}
          {template.is_published ? ' (Published)' : ' (Draft)'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onClick={onSave}
          disabled={isSaving || !hasUnsavedChanges}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Draft
        </Button>
        <Button onClick={onPublish} disabled={isPublishing}>
          {isPublishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Publish
        </Button>
      </div>
    </div>
  );
}

interface FeedbackProps {
  saveError: Error | null;
  publishError: Error | null;
  isSaveSuccess: boolean;
  isPublishSuccess: boolean;
}

function MutationFeedback({
  saveError,
  publishError,
  isSaveSuccess,
  isPublishSuccess,
}: FeedbackProps): JSX.Element {
  return (
    <>
      {isSaveSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Template draft saved successfully.
        </div>
      )}
      {isPublishSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Template published successfully.
        </div>
      )}
      {saveError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to save draft: {String(saveError)}
        </div>
      )}
      {publishError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to publish: {String(publishError)}
        </div>
      )}
    </>
  );
}
