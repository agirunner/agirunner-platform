import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Loader2, Plus } from 'lucide-react';

import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import {
  DIALOG_ALERT_CLASS_NAME,
  ERROR_PANEL_STYLE,
  ERROR_TEXT_STYLE,
  FIELD_ERROR_CLASS_NAME,
} from './llm-providers-page.chrome.js';
import { getProviderTypeDefaults, INITIAL_FORM } from './llm-providers-page.defaults.js';
import {
  describeProviderTypeSetup,
  type AddProviderDraft,
  type ProviderType,
  validateAddProviderDraft,
} from './llm-providers-page.support.js';
import type { OAuthProfile } from './llm-providers-page.types.js';

function renderProfileCostLabel(profile: OAuthProfile): string {
  return profile.costModel === 'subscription' ? 'Subscription' : 'Pay-per-token';
}

export function ConnectOAuthDialog(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['oauth-profiles'],
    queryFn: () => dashboardApi.listOAuthProfiles(),
    enabled: isOpen,
  });

  const connectMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const result = await dashboardApi.initiateOAuthFlow(profileId);
      window.location.assign(result.authorizeUrl);
    },
    onError: (error) => {
      toast.error(`Failed to start OAuth flow: ${String(error)}`);
    },
  });

  const profiles = profilesQuery.data ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)}>
        <Link2 className="h-4 w-4" />
        Connect Subscription
      </Button>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Subscription Provider</DialogTitle>
        </DialogHeader>
        <p className="mb-4 text-sm text-muted">
          Use your existing subscription (e.g. ChatGPT Plus/Pro) to access LLM models without
          separate API billing.
        </p>
        {profilesQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : null}
        {profilesQuery.error ? (
          <div className={DIALOG_ALERT_CLASS_NAME} style={ERROR_PANEL_STYLE}>
            Failed to load profiles: {String(profilesQuery.error)}
          </div>
        ) : null}
        <div className="space-y-3">
          {profiles.map((profile) => (
            <Card
              key={profile.profileId}
              className="cursor-pointer transition-colors hover:border-primary"
            >
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted">{profile.description}</p>
                  <Badge variant="outline" className="mt-1">
                    {renderProfileCostLabel(profile)}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => connectMutation.mutate(profile.profileId)}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Connect
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AddProviderDialog(props: { existingNames: string[] }): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<AddProviderDraft>(INITIAL_FORM);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const validation = validateAddProviderDraft(form, {
    existingNames: props.existingNames,
  });
  const providerSetup = describeProviderTypeSetup(form.providerType);
  const providerDefaults = getProviderTypeDefaults(form.providerType);
  const canResetRecommendedEndpoint = form.baseUrl.trim() !== providerDefaults.baseUrl.trim();
  const showsRecommendedName =
    providerDefaults.name.trim().length > 0 && form.name.trim() !== providerDefaults.name.trim();

  function handleProviderTypeChange(providerType: ProviderType) {
    const defaults = getProviderTypeDefaults(providerType);
    setForm((prev) => ({
      ...prev,
      providerType,
      name: defaults.name,
      baseUrl: defaults.baseUrl,
    }));
  }

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setForm(INITIAL_FORM);
      setHasAttemptedSubmit(false);
      mutation.reset();
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const provider = await dashboardApi.createLlmProvider({
        name: form.name,
        baseUrl: form.baseUrl,
        apiKeySecretRef: form.apiKey,
        metadata: { providerType: form.providerType },
      });
      await dashboardApi.discoverLlmModels(provider.id);
      return provider;
    },
    onSuccess: (provider) => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      toast.success(`Provider "${provider.name}" created and models discovered.`);
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to add provider: ${String(error)}`);
    },
  });

  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: mutation.error ? String(mutation.error) : null,
    showValidation: hasAttemptedSubmit,
    isValid: validation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Provider
      </Button>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add LLM Provider</DialogTitle>
          <DialogDescription>
            Choose the provider type first. The dialog pre-fills the supported endpoint and shows
            what still needs operator input.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validation.isValid) {
              setHasAttemptedSubmit(true);
              return;
            }
            mutation.mutate();
          }}
        >
          <section className="space-y-3 rounded-xl border border-border/70 bg-border/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Provider setup</h3>
                <p className="text-sm text-muted">{providerSetup.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{providerSetup.title}</Badge>
                <Badge variant="outline">{providerSetup.authLabel}</Badge>
              </div>
            </div>
            <p className="text-xs text-muted">
              Required provider details are highlighted under each field after you try to save.
            </p>
          </section>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium">Provider Type</label>
              {canResetRecommendedEndpoint ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      baseUrl: providerDefaults.baseUrl,
                    }))
                  }
                >
                  Restore recommended endpoint
                </Button>
              ) : null}
            </div>
            <Select
              value={form.providerType}
              onValueChange={(value) => handleProviderTypeChange(value as ProviderType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="openai-compatible">
                  OpenAI-Compatible (Ollama, vLLM, etc.)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted">
              Selecting a provider type auto-fills the recommended name and base URL.
            </p>
          </div>
          <ProviderTextField
            label="Name"
            value={form.name}
            placeholder="My Provider"
            error={hasAttemptedSubmit ? validation.fieldErrors.name : undefined}
            helperText={
              showsRecommendedName
                ? `Recommended operator label for this provider type: ${providerDefaults.name}`
                : 'Use a short operator-facing label that will still make sense in assignment and fleet views.'
            }
            onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
          />
          <ProviderTextField
            label="Base URL"
            value={form.baseUrl}
            placeholder={
              form.providerType === 'openai-compatible'
                ? 'http://localhost:11434/v1'
                : 'https://api.openai.com/v1'
            }
            error={hasAttemptedSubmit ? validation.fieldErrors.baseUrl : undefined}
            helperText={
              form.providerType === 'openai-compatible'
                ? 'Compatible gateways may use either http:// or https:// endpoints.'
                : `Hosted providers should use a secure https:// endpoint. Recommended: ${providerDefaults.baseUrl}`
            }
            onChange={(value) => setForm((prev) => ({ ...prev, baseUrl: value }))}
          />
          <ProviderTextField
            label={
              <>
                API Key
                {form.providerType === 'openai-compatible' ? (
                  <span className="ml-1 text-xs font-normal text-muted">(optional)</span>
                ) : null}
              </>
            }
            type="password"
            value={form.apiKey}
            placeholder={
              form.providerType === 'openai-compatible' ? 'Set API key (optional)' : 'Paste API key'
            }
            error={hasAttemptedSubmit ? validation.fieldErrors.apiKey : undefined}
            helperText="Stored write-only. Existing keys are never shown again."
            onChange={(value) => setForm((prev) => ({ ...prev, apiKey: value }))}
          />
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add Provider
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderTextField(props: {
  label: JSX.Element | string;
  value: string;
  placeholder: string;
  helperText: string;
  error?: string;
  type?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{props.label}</label>
      <Input
        type={props.type}
        placeholder={props.placeholder}
        value={props.value}
        className={props.error ? 'border-red-300 focus-visible:ring-red-500' : undefined}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.error ? (
        <p className={FIELD_ERROR_CLASS_NAME} style={ERROR_TEXT_STYLE}>
          {props.error}
        </p>
      ) : (
        <p className="text-xs text-muted">{props.helperText}</p>
      )}
    </div>
  );
}
