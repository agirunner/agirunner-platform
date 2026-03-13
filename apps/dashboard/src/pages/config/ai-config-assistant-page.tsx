import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, Sparkles } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { readSession } from '../../lib/session.js';
import {
  ASSISTANT_STARTER_PROMPTS,
  resolveSuggestionDestination,
  summarizeAssistantSession,
  type AssistantMessageRecord,
  type ConfigSuggestion,
} from './ai-config-assistant-page.support.js';
import {
  AssistantQuickPrompts,
  AssistantSummaryCards,
  ChatBubble,
  SuggestionCard,
} from './ai-config-assistant-page.sections.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface AssistantResponse {
  reply: string;
  suggestions?: ConfigSuggestion[];
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
}

async function askAssistant(question: string): Promise<AssistantResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/assistant`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify({ question }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return (body.data ?? body) as AssistantResponse;
}

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

  const mutation = useMutation({
    mutationFn: askAssistant,
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
          content: 'Sorry, I could not process your request. Please try again.',
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
    setMessages((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: 'user', content: trimmed },
    ]);
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
              Ask configuration questions, get advisory suggestions grounded in the current runtime and playbook model, and open the matching settings surfaces to review them.
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
              Suggestions are advisory only. Review the linked configuration page before making changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              ref={scrollRef}
              className="space-y-4 overflow-y-auto rounded-lg border border-border bg-surface/50 p-4"
              style={{ maxHeight: 'min(60vh, 700px)' }}
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted">
                  <Sparkles className="mb-3 h-10 w-10" />
                  <p className="font-medium text-foreground">How can I help with your configuration?</p>
                  <p className="mt-1 max-w-xl text-sm leading-6">
                    Start with a quick audit or ask about runtimes, providers, playbooks, integrations, work items, and operator controls.
                  </p>
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
                              setReviewedSuggestions((current) => new Set([...current, suggestion.path]))
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
                placeholder="Ask about runtime defaults, model posture, playbooks, or integrations..."
                disabled={mutation.isPending}
                className="flex-1"
              />
              <Button type="submit" disabled={mutation.isPending || !inputValue.trim()}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
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
