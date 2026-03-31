import { Button } from '../../../components/ui/button.js';
import type { PlaybookAuthoringDraft } from './playbook-authoring-support.js';

export interface SectionProps {
  draft: PlaybookAuthoringDraft;
  showValidationErrors?: boolean;
  onChange(updater: (current: PlaybookAuthoringDraft) => PlaybookAuthoringDraft): void;
}

export const ROLE_SELECT_UNSET = '__unset__';
export const ENTRY_COLUMN_UNSET = '__unset__';
export const ORCHESTRATION_POLICY_UNSET = '__orchestration_policy_default__';

export function IconButton(props: { icon: JSX.Element; onClick?: () => void }): JSX.Element {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      disabled={!props.onClick}
      onClick={props.onClick}
    >
      {props.icon}
    </Button>
  );
}

export function ValidationText(props: { issue?: string }): JSX.Element | null {
  return props.issue ? (
    <p className="text-xs text-red-600 dark:text-red-400">{props.issue}</p>
  ) : null;
}
