import { Sparkles } from 'lucide-react';

import { Input } from '../../../components/ui/input.js';

export interface ConversationalLaunchBarProps {
  disabled?: boolean;
}

export function ConversationalLaunchBar({ disabled = true }: ConversationalLaunchBarProps): JSX.Element {
  return (
    <div className="relative flex items-center">
      <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent-primary/40 pointer-events-none" />
      <Input
        type="text"
        placeholder="AI-assisted launch coming soon. Use the playbook catalog to get started."
        disabled={disabled}
        className="pl-9 cursor-not-allowed opacity-60"
      />
    </div>
  );
}
