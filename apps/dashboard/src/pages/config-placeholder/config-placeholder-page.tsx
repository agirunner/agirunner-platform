import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';

export function ConfigPlaceholderPage(props: {
  navHref: string;
  description: string;
}): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader navHref={props.navHref} description={props.description} />
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted">Coming in the next iteration, stay tuned.</p>
        </CardContent>
      </Card>
    </div>
  );
}
