import { useCallback, useRef, useState } from 'react';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';

const Editor = MonacoEditor as unknown as React.ComponentType<{
  height: string;
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  onMount?: OnMount;
  options?: Record<string, unknown>;
}>;
import type { TemplateDefinition } from './template-editor-types.js';

interface CodeTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

export function CodeTab({ template, onChange }: CodeTabProps): JSX.Element {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const jsonValue = JSON.stringify(template, null, 2);

  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;

      try {
        const parsed = JSON.parse(value) as TemplateDefinition;
        setParseError(null);
        onChange(parsed);
      } catch (err) {
        setParseError(String(err));
      }
    },
    [onChange],
  );

  const handleFormat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentValue = editor.getValue();
    try {
      const parsed = JSON.parse(currentValue);
      const formatted = JSON.stringify(parsed, null, 2);
      editor.setValue(formatted);
      setParseError(null);
    } catch {
      /* formatting skipped for invalid JSON */
    }
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Edit the template definition as JSON. Changes sync with the Visual tab.
        </p>
        <button
          type="button"
          onClick={handleFormat}
          className="text-xs text-accent hover:underline"
        >
          Format JSON
        </button>
      </div>

      {parseError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {parseError}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <Editor
          height="600px"
          language="json"
          value={jsonValue}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            formatOnPaste: true,
          }}
        />
      </div>
    </div>
  );
}
