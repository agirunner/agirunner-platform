import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent } from '../../components/ui/card.js';

export function ProjectDeliveryHistory({ projectId: _projectId }: { projectId: string }): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="grid gap-5 p-6 sm:p-8">
        <div className="space-y-3">
          <Badge variant="warning" className="w-fit">
            In Development
          </Badge>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Project delivery is being rebuilt
            </h2>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              This project-scoped delivery view is temporarily offline while the operational
              surfaces are redesigned. We will bring it back after the broader workflow and live
              board delivery experience is rebuilt around the V2 operating model.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
