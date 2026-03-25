import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { dashboardApi } from '../../lib/api.js';
import {
  ASSISTANT_STARTER_PROMPTS,
  buildAssistantReviewBuckets,
  buildAssistantSessionStage,
  resolveSuggestionDestination,
  summarizeAssistantSession,
  type AssistantMessageRecord,
} from './ai-config-assistant-page.support.js';
import {
  AssistantQuickPrompts,
  AssistantReviewQueue,
  AssistantSessionStateCard,
  AssistantSummaryCards,
  ChatBubble,
  SuggestionCard,
} from './ai-config-assistant-page.sections.js';

export function AiConfigAssistantPage(): JSX.Element {
  const [messages, setMessages] = useState<AssistantMessageRecord[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [reviewedSuggestions, setReviewedSuggestions] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(0);
  const summaryCards = useMemo(
    () => summarizeAssistantSession(messages, reviewedSuggestions.size),
    [messages, reviewedSuggestions],
  );
  const sessionStage = useMemo(
    () => buildAssistantSessionStage(messages, reviewedSuggestions.size),
    [messages, reviewedSuggestions],
  );
  const reviewBuckets = useMemo(
    () => buildAssistantReviewBuckets(messages, reviewedSuggestions),
    [messages, reviewedSuggestions],
  );

  const mutation = useMutation({
    mutationFn: (question: string) => dashboardApi.askConfigAssistant(question),
    onSuccess: (response) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: 'assistant',
          content: response.reply,
          suggestions: response.suggestions,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextIdRef.current++,
          role: 'assistant',
          content:
            'I could not process that request. Retry with a narrower question or open the target config page directly to continue the review.',
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function sendQuestion(question: string): void {
    const trimmed = question.trim();
    if (!trimmed) {
      return;
    }
    setMessages((prev) => [...prev, { id: nextIdRef.current++, role: 'user', content: trimmed }]);
    setInputValue('');
    mutation.mutate(trimmed);
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-accent" />
              <CardTitle className="text-2xl">AI Config Assistant</CardTitle>
            </div>
            <CardDescription className="max-w-3xl text-sm leading-6">
              Ask configuration questions, get advisory suggestions grounded in current agent
              settings and the playbook model, and open the matching settings surfaces to review
              them.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => sendQuestion(ASSISTANT_STARTER_PROMPTS[0]?.prompt ?? '')}
          >
            <Sparkles className="h-4 w-4" />
            Run quick audit
          </Button>
        </CardHeader>
      </Card>

      <AssistantSummaryCards cards={summaryCards} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle>Assistant session</CardTitle>
            <CardDescription>
              Suggestions are advisory only. Review the linked configuration page before making
              changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssistantSessionStateCard stage={sessionStage} />
            <div
              ref={scrollRef}
              className="space-y-4 overflow-y-auto rounded-lg border border-border bg-surface/50 p-4"
              style={{ maxHeight: 'min(60vh, 700px)' }}
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted">
                  <Sparkles className="mb-3 h-10 w-10" />
                  <p className="font-medium text-foreground">
                    How can I help with your configuration?
                  </p>
                  <p className="mt-1 max-w-xl text-sm leading-6">
                    Start with a quick audit or ask about specialist agents, providers, playbooks,
                    integrations, work items, and operator controls.
                  </p>
                  <Button
                    type="button"
                    className="mt-4"
                    onClick={() => sendQuestion(ASSISTANT_STARTER_PROMPTS[0]?.prompt ?? '')}
                  >
                    <Sparkles className="h-4 w-4" />
                    Run quick audit
                  </Button>
                </div>
              ) : null}

              {messages.map((message) => (
                <div key={message.id} className="space-y-2">
                  <ChatBubble message={message} />
                  {message.suggestions?.length ? (
                    <div className="ml-0 space-y-2 md:ml-11">
                      {message.suggestions.map((suggestion) => {
                        const destination = resolveSuggestionDestination(suggestion.path);
                        return (
                          <SuggestionCard
                            key={`${message.id}-${suggestion.path}`}
                            suggestion={suggestion}
                            isReviewed={reviewedSuggestions.has(suggestion.path)}
                            destinationHref={destination?.href}
                            destinationLabel={destination?.label}
                            onMarkReviewed={() =>
                              setReviewedSuggestions(
                                (current) => new Set([...current, suggestion.path]),
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}

              {mutation.isPending ? (
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10">
                    <Sparkles className="h-4 w-4 animate-pulse text-accent" />
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted">
                    Thinking through the configuration state...
                  </div>
                </div>
              ) : null}
            </div>

            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                sendQuestion(inputValue);
              }}
            >
              <Input
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="Ask about specialist agents, model posture, playbooks, or integrations..."
                disabled={mutation.isPending}
                aria-label="Configuration question"
                className="flex-1"
              />
              <Button type="submit" disabled={mutation.isPending || !inputValue.trim()}>
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </Button>
            </form>
            <p className="text-xs leading-5 text-muted">
              Keep prompts narrow. Ask for one operator decision at a time so the review handoff
              stays tied to a specific config surface.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <AssistantReviewQueue buckets={reviewBuckets} />
          <AssistantQuickPrompts
            prompts={ASSISTANT_STARTER_PROMPTS}
            disabled={mutation.isPending}
            onSelect={sendQuestion}
          />
        </div>
      </div>
    </div>
  );
}
