import { FieldRow } from '@/design-system/grammar/index.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { zodResolver } from '@hookform/resolvers/zod';
import type { AiRuntimeStatus } from '@offisim/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const apiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, 'Enter a valid OpenRouter API key.')
    .refine((value) => !/\s/u.test(value), 'API keys cannot contain spaces.'),
});

type ApiKeyForm = z.infer<typeof apiKeySchema>;

export function ApiKeyDialog({
  open,
  onOpenChange,
  accountId,
  onConfigured,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  onConfigured: (status: AiRuntimeStatus) => Promise<void> | void;
}) {
  const form = useForm<ApiKeyForm>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { apiKey: '' },
  });
  const configure = useMutation({
    mutationFn: async ({ apiKey }: ApiKeyForm) => {
      return invokeCommand('agent_runtime_configure_api_account', {
        req: {
          service: 'openrouter',
          ...(accountId ? { accountId } : {}),
          apiKey,
        },
      });
    },
    onSuccess: async (status) => {
      form.reset();
      await onConfigured(status);
      onOpenChange(false);
      toast.success(accountId ? 'API key replaced' : 'API account added');
    },
    onError: (error) => {
      toast.error(accountId ? 'API key was not replaced' : 'API account was not added', {
        description: safeErrorMessage(error),
      });
    },
  });

  useEffect(() => {
    if (!open) form.reset();
  }, [form, open]);

  const title = accountId ? 'Replace OpenRouter API key' : 'Add OpenRouter API account';
  return (
    <Dialog open={open} onOpenChange={(next) => !configure.isPending && onOpenChange(next)}>
      <DialogContent className="off-dialog-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            The key is stored locally on this Mac and is never shown again.{' '}
            {accountId
              ? 'This replacement starts a new billing identity; earlier usage remains separate.'
              : 'Usage and cost are tracked separately from subscription accounts.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="off-set-api-key-form"
          onSubmit={form.handleSubmit((values) => configure.mutate(values))}
        >
          <FieldRow
            label="API key"
            hint={
              form.formState.errors.apiKey?.message ?? 'Create a key in your OpenRouter account.'
            }
            warn={Boolean(form.formState.errors.apiKey)}
          >
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-or-v1-…"
                autoFocus
                disabled={configure.isPending}
                {...form.register('apiKey')}
              />
            )}
          </FieldRow>
          <DialogFooter>
            <Button
              variant="subtle"
              onClick={() => onOpenChange(false)}
              disabled={configure.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={configure.isPending}>
              {configure.isPending ? 'Saving…' : accountId ? 'Replace key' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
