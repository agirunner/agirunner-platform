import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import type { RemoteMcpDeviceAuthorizationState } from './mcp-page.oauth-flow.js';

export function McpPageDeviceAuthorizationDialog(props: {
  open: boolean;
  state: RemoteMcpDeviceAuthorizationState | null;
  isPolling: boolean;
  error: string | null;
  onOpenVerificationPage(): void;
  onCheckStatus(): void;
  onClose(): void;
}) {
  const state = props.state;

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete device authorization</DialogTitle>
          <DialogDescription>
            Finish the OAuth device flow in the verification page, then check the status here to complete the MCP server connection.
          </DialogDescription>
        </DialogHeader>

        {state ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">User code</span>
                <Input readOnly value={state.userCode} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Recommended poll interval</span>
                <Input readOnly value={`${state.intervalSeconds} seconds`} />
              </label>
            </div>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Verification URL</span>
              <Input readOnly value={state.verificationUriComplete ?? state.verificationUri} />
            </label>
            <p className="text-sm text-muted">
              This flow expires after approximately {state.expiresInSeconds} seconds unless the provider finishes authorization first.
            </p>
          </div>
        ) : null}

        {props.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{props.error}</p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Close
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={props.onOpenVerificationPage}>
              Open verification page
            </Button>
            <Button type="button" onClick={props.onCheckStatus} disabled={props.isPolling}>
              Check status
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
