import { Link } from 'react-router-dom';
import { ArrowRight, Check, ClipboardCheck, ListChecks, Sparkles, User } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import type {
  AssistantMessageRecord,
  AssistantReviewBucket,
  AssistantSessionStageSummary,
  AssistantStarterPrompt,
  AssistantSummaryCard,
  ConfigSuggestion,
} from './ai-config-assistant-page.support.js';

export function AssistantSummaryCards(props: { cards: AssistantSummaryCard[] }): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {props.cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <CardTitle className="text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function AssistantQuickPrompts(props: {
  prompts: AssistantStarterPrompt[];
  disabled: boolean;
  onSelect(prompt: string): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle>Quick asks</CardTitle>
        <CardDescription>
          Start with a concrete operator audit instead of typing from scratch.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {props.prompts.map((prompt) => (
          <Button
            key={prompt.label}
            type="button"
            variant="outline"
            disabled={props.disabled}
            className="justify-start whitespace-normal text-left"
            onClick={() => props.onSelect(prompt.prompt)}
          >
            {prompt.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

export function AssistantSessionStateCard(props: {
  stage: AssistantSessionStageSummary;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-muted/10 shadow-none">
      <CardContent className="space-y-3 p-4">
        <Badge variant="outline">{props.stage.badge}</Badge>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{props.stage.title}</p>
          <p className="text-sm leading-6 text-muted">{props.stage.detail}</p>
        </div>
        <div className="rounded-xl bg-background/80 p-3 text-sm leading-6 text-muted">
          <span className="font-medium text-foreground">Next step:</span> {props.stage.nextAction}
        </div>
      </CardContent>
    </Card>
  );
}

export function AssistantReviewQueue(props: {
  buckets: AssistantReviewBucket[];
}): JSX.Element | null {
  if (props.buckets.length === 0) {
    return null;
  }

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-accent" />
          Review queue
        </CardTitle>
        <CardDescription>
          Keep the handoff bounded. Review one config surface at a time and mark each suggestion
          when the underlying settings have been checked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.buckets.map((bucket) => (
          <div key={bucket.key} className="rounded-xl border border-border/70 bg-muted/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{bucket.label}</p>
                <p className="text-sm leading-6 text-muted">{bucket.detail}</p>
              </div>
              <Badge variant={bucket.pendingCount > 0 ? 'warning' : 'success'}>
                {bucket.pendingCount > 0
                  ? `${bucket.pendingCount} pending`
                  : `${bucket.reviewedCount} reviewed`}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
              <span>{bucket.reviewedCount} reviewed</span>
              <span>{bucket.pendingCount} pending</span>
            </div>
            {bucket.href && bucket.actionLabel ? (
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link to={bucket.href}>
                  {bucket.actionLabel}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ChatBubble(props: { message: AssistantMessageRecord }): JSX.Element {
  const isUser = props.message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser ? (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10">
          <Sparkles className="h-4 w-4 text-accent" />
        </div>
      ) : null}
      <div
        className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
          isUser ? 'bg-accent text-white' : 'border border-border bg-surface'
        }`}
      >
        <p className="whitespace-pre-wrap">{props.message.content}</p>
      </div>
      {isUser ? (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-border">
          <User className="h-4 w-4 text-muted" />
        </div>
      ) : null}
    </div>
  );
}

export function SuggestionCard(props: {
  suggestion: ConfigSuggestion;
  isReviewed: boolean;
  destinationHref?: string;
  destinationLabel?: string;
  onMarkReviewed(): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-muted/10 shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <code className="rounded bg-border/30 px-1.5 py-0.5 text-xs font-mono">
            {props.suggestion.path}
          </code>
          <Badge variant={props.isReviewed ? 'success' : 'outline'}>
            {props.isReviewed ? 'Reviewed' : 'Advisory only'}
          </Badge>
        </div>
        <p className="text-sm text-foreground">{props.suggestion.description}</p>
        {props.suggestion.current_value ? (
          <div className="rounded-xl bg-background/80 p-3 text-xs">
            <span className="text-muted">Current </span>
            <code className="font-mono text-foreground">{props.suggestion.current_value}</code>
          </div>
        ) : null}
        <div className="rounded-xl bg-background/80 p-3 text-xs">
          <span className="text-muted">Suggested </span>
          <code className="font-mono text-foreground">{props.suggestion.suggested_value}</code>
        </div>
        <div className="flex items-start gap-2 rounded-xl bg-background/80 p-3 text-sm leading-6 text-muted">
          <ClipboardCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
          <p>
            Review the linked config surface before marking this suggestion reviewed. The assistant
            never applies changes from this page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {props.destinationHref && props.destinationLabel ? (
            <Button asChild size="sm" variant="outline" className="h-8">
              <Link to={props.destinationHref}>{props.destinationLabel}</Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={props.isReviewed ? 'outline' : 'default'}
            className="h-8"
            disabled={props.isReviewed}
            onClick={props.onMarkReviewed}
          >
            {props.isReviewed ? <Check className="h-3 w-3" /> : null}
            {props.isReviewed ? 'Reviewed' : 'Mark reviewed'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
