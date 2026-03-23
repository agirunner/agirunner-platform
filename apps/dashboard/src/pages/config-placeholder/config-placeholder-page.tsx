import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';

export function ConfigPlaceholderPage(props: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">{props.description}</p>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted">
            This surface is reserved for the next version of the product.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
