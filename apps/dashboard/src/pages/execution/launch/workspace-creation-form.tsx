import { useState } from 'react';

import { Button } from '../../../components/ui/button.js';
import { Input } from '../../../components/ui/input.js';

export interface WorkspaceCreationFormProps {
  onSubmit: (workspace: { name: string; repoUrl: string; defaultBranch: string }) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

interface WorkspaceFormData {
  name: string;
  repoUrl: string;
  defaultBranch: string;
}

export function validateWorkspaceForm(data: { name: string; repoUrl: string }): string[] {
  const errors: string[] = [];
  if (data.name.trim() === '') {
    errors.push('Name is required');
  }
  if (data.repoUrl.trim() === '') {
    errors.push('Repository URL is required');
  }
  return errors;
}

export function WorkspaceCreationForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: WorkspaceCreationFormProps): JSX.Element {
  const [formData, setFormData] = useState<WorkspaceFormData>({
    name: '',
    repoUrl: '',
    defaultBranch: 'main',
  });
  const [errors, setErrors] = useState<string[]>([]);

  function handleChange(field: keyof WorkspaceFormData, value: string): void {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors.length > 0) {
      setErrors([]);
    }
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const validationErrors = validateWorkspaceForm(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    onSubmit({
      name: formData.name.trim(),
      repoUrl: formData.repoUrl.trim(),
      defaultBranch: formData.defaultBranch.trim() || 'main',
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '8px',
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      <h4 style={{
        margin: 0,
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--color-text-primary)',
      }}>
        Create New Workspace
      </h4>

      {errors.length > 0 && (
        <ul style={{
          margin: 0,
          padding: '8px 12px',
          backgroundColor: 'var(--color-status-error-bg, rgba(239,68,68,0.1))',
          border: '1px solid var(--color-status-error, #ef4444)',
          borderRadius: '6px',
          listStyle: 'none',
          fontSize: '12px',
          color: 'var(--color-status-error, #ef4444)',
        }}>
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label
          htmlFor="ws-name"
          style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
        >
          Name <span style={{ color: 'var(--color-status-error, #ef4444)' }}>*</span>
        </label>
        <Input
          id="ws-name"
          type="text"
          placeholder="My Project Workspace"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label
          htmlFor="ws-repo-url"
          style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
        >
          Repository URL <span style={{ color: 'var(--color-status-error, #ef4444)' }}>*</span>
        </label>
        <Input
          id="ws-repo-url"
          type="text"
          placeholder="https://github.com/org/repo"
          value={formData.repoUrl}
          onChange={(e) => handleChange('repoUrl', e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label
          htmlFor="ws-branch"
          style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
        >
          Default Branch
        </label>
        <Input
          id="ws-branch"
          type="text"
          placeholder="main"
          value={formData.defaultBranch}
          onChange={(e) => handleChange('defaultBranch', e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating…' : 'Create Workspace'}
        </Button>
      </div>
    </form>
  );
}
