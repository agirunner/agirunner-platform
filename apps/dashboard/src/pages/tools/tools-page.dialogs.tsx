import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import type { ToolCategory } from './tools-page.support.js';
import { TOOL_CATEGORIES, describeToolCategory } from './tools-page.support.js';

export interface ToolTagDraft {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
}

export function createEmptyToolTagDraft(): ToolTagDraft {
  return {
    id: '',
    name: '',
    description: '',
    category: TOOL_CATEGORIES[0],
  };
}

export function ToolTagEditorDialog(props: {
  isOpen: boolean;
  mode: 'create' | 'edit';
  draft: ToolTagDraft;
  error: string | null;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onDraftChange(draft: ToolTagDraft): void;
  onSubmit(): void;
}): JSX.Element {
  const canSubmit =
    Boolean(props.draft.id.trim()) &&
    Boolean(props.draft.name.trim()) &&
    Boolean(props.draft.category.trim()) &&
    !props.isPending;

  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.mode === 'create' ? 'Create Tool Tag' : 'Edit Tool Tag'}</DialogTitle>
          <DialogDescription>
            {props.mode === 'create'
              ? 'Register a custom tool tag so role and workspace tool matching stays UI-manageable.'
              : 'Update the custom tool tag without changing any built-in tool definitions.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-medium">ID</div>
            <Input
              value={props.draft.id}
              onChange={(event) => props.onDraftChange({ ...props.draft, id: event.target.value })}
              placeholder="ship_handoff"
              disabled={props.mode === 'edit' || props.isPending}
            />
          </div>
          <div className="grid gap-2">
            <div className="text-sm font-medium">Name</div>
            <Input
              value={props.draft.name}
              onChange={(event) => props.onDraftChange({ ...props.draft, name: event.target.value })}
              placeholder="Ship Handoff"
              disabled={props.isPending}
            />
          </div>
          <div className="grid gap-2">
            <div className="text-sm font-medium">Category</div>
            <Select
              value={props.draft.category}
              onValueChange={(value) => props.onDraftChange({ ...props.draft, category: value as ToolCategory })}
              disabled={props.isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {TOOL_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {describeToolCategory(category).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <div className="text-sm font-medium">Description</div>
            <Textarea
              value={props.draft.description}
              onChange={(event) =>
                props.onDraftChange({ ...props.draft, description: event.target.value })
              }
              placeholder="Explain what this tag should signal to operators and role matching."
              rows={4}
              disabled={props.isPending}
            />
          </div>
          {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button onClick={props.onSubmit} disabled={!canSubmit}>
              {props.mode === 'create' ? 'Create Tool Tag' : 'Save Tool Tag'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ToolTagDeleteDialog(props: {
  isOpen: boolean;
  toolName: string;
  error: string | null;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(): void;
}): JSX.Element {
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Tool Tag</DialogTitle>
          <DialogDescription>
            Remove &ldquo;{props.toolName}&rdquo; from the custom tool catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-sm text-muted">
            Built-in tools stay protected. This only deletes the selected custom tag.
          </p>
          {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              disabled={props.isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={props.onSubmit} disabled={props.isPending}>
              Delete Tool Tag
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
