import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Send, Check, User } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardContent } from '../../components/ui/card.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: ConfigSuggestion[];
}

interface ConfigSuggestion {
  path: string;
  current_value?: string;
  suggested_value: string;
  description: string;
}

interface AssistantResponse {
  reply: string;
  suggestions?: ConfigSuggestion[];
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
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

function ChatBubble({ message }: { message: AssistantMessage }): JSX.Element {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10">
          <Sparkles className="h-4 w-4 text-accent" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
          isUser
            ? 'bg-accent text-white'
            : 'border border-border bg-surface'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
      {isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-border">
          <User className="h-4 w-4 text-muted" />
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onApply,
  isApplied,
}: {
  suggestion: ConfigSuggestion;
  onApply: () => void;
  isApplied: boolean;
}): JSX.Element {
  return (
    <Card className="border-accent/30">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <code className="rounded bg-border/30 px-1.5 py-0.5 text-xs font-mono">
            {suggestion.path}
          </code>
          <Button
            size="sm"
            variant={isApplied ? 'outline' : 'default'}
            className="h-7 px-2 text-xs"
            disabled={isApplied}
            onClick={onApply}
          >
            {isApplied ? (
              <>
                <Check className="h-3 w-3" />
                Applied
              </>
            ) : (
              'Apply'
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{suggestion.description}</p>
        {suggestion.current_value && (
          <div className="text-xs">
            <span className="text-muted-foreground">Current: </span>
            <code className="text-red-600">{suggestion.current_value}</code>
          </div>
        )}
        <div className="text-xs">
          <span className="text-muted-foreground">Suggested: </span>
          <code className="text-green-600">{suggestion.suggested_value}</code>
        </div>
      </CardContent>
    </Card>
  );
}

export function AiConfigAssistantPage(): JSX.Element {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nextIdRef = useRef(0);

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

  function handleSend(): void {
    const question = inputValue.trim();
    if (!question) return;

    setMessages((prev) => [
      ...prev,
      { id: nextIdRef.current++, role: 'user', content: question },
    ]);
    setInputValue('');
    mutation.mutate(question);
  }

  function handleApplySuggestion(suggestion: ConfigSuggestion): void {
    setAppliedSuggestions((prev) => new Set([...prev, suggestion.path]));
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-6 w-6" />
          AI Config Assistant
        </h1>
        <p className="text-sm text-muted">
          Ask questions about your platform configuration and get suggestions.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-surface/50 p-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted">
            <Sparkles className="mb-3 h-10 w-10" />
            <p className="font-medium">How can I help with your configuration?</p>
            <p className="mt-1 text-sm">
              Ask about LLM providers, runtime settings, templates, and more.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="space-y-2">
            <ChatBubble message={msg} />
            {msg.suggestions && msg.suggestions.length > 0 && (
              <div className="ml-11 space-y-2">
                {msg.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.path}
                    suggestion={suggestion}
                    isApplied={appliedSuggestions.has(suggestion.path)}
                    onApply={() => handleApplySuggestion(suggestion)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}

        {mutation.isPending && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10">
              <Sparkles className="h-4 w-4 animate-pulse text-accent" />
            </div>
            <div className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-muted-foreground">
              Thinking...
            </div>
          </div>
        )}
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about configuration..."
          disabled={mutation.isPending}
          className="flex-1"
        />
        <Button type="submit" disabled={mutation.isPending || !inputValue.trim()}>
          <Send className="h-4 w-4" />
          Send
        </Button>
      </form>
    </div>
  );
}
