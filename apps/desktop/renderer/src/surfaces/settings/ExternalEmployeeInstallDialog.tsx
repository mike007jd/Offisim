import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Dialog, DialogContent } from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Check, Globe, Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type DiscoveredCard, discoverAgentCard } from './settings-data.js';

const discoverSchema = z.object({
  url: z.string().min(1, 'Agent card URL is required'),
});
type DiscoverValues = z.infer<typeof discoverSchema>;

interface ExternalEmployeeInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (card: DiscoveredCard) => Promise<void>;
}

export function ExternalEmployeeInstallDialog({
  open,
  onOpenChange,
  onInstalled,
}: ExternalEmployeeInstallDialogProps) {
  const [card, setCard] = useState<DiscoveredCard | null>(null);
  const [discoveredUrl, setDiscoveredUrl] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const form = useForm<DiscoverValues>({
    resolver: zodResolver(discoverSchema),
    defaultValues: { url: '' },
  });
  const urlValue = form.watch('url');

  function reset() {
    setCard(null);
    setDiscoveredUrl(null);
    setDiscovering(false);
    setDiscoverError(null);
    setConnecting(false);
    setInstallError(null);
    form.reset({ url: '' });
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  // Editing the URL after a lookup drops the stale preview so Connect can't fire
  // against a card that no longer matches the field.
  useEffect(() => {
    if (card && urlValue !== discoveredUrl) {
      setCard(null);
      setDiscoveredUrl(null);
      setInstallError(null);
    }
  }, [urlValue, card, discoveredUrl]);

  const onDiscover = form.handleSubmit(async ({ url }) => {
    setDiscovering(true);
    setDiscoverError(null);
    setCard(null);
    try {
      const result = await discoverAgentCard(url);
      setCard(result);
      setDiscoveredUrl(url);
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Could not reach A2A card');
    } finally {
      setDiscovering(false);
    }
  });

  async function runConnect() {
    if (!card) return;
    setConnecting(true);
    setInstallError(null);
    try {
      await onInstalled(card);
      handleOpenChange(false);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'No connection was created.');
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="off-dialog-w-md" showClose={!connecting}>
        <div className="flex flex-col gap-[var(--off-sp-5)]">
          <div>
            <div className="off-set-panetitle">Connect external employee</div>
            <div className="off-set-panedesc">
              Look up an A2A agent card, then connect it as an employee.
            </div>
          </div>

          <form onSubmit={onDiscover} className="off-field">
            <label className="off-field-label" htmlFor="ext-card-url">
              Agent card URL
            </label>
            <div className="flex gap-[var(--off-sp-3)]">
              <div className={`off-set-ctl is-mono flex-1${discoverError ? ' is-invalid' : ''}`}>
                <span className="off-set-ctl-lead">
                  <Icon icon={Globe} size="sm" />
                </span>
                <Input
                  id="ext-card-url"
                  className="off-set-ctl-input"
                  placeholder="https://agent.openclaw.ai/.well-known/agent.json"
                  {...form.register('url')}
                />
              </div>
              <Button type="submit" variant="outline" size="md" disabled={discovering}>
                <Icon
                  icon={discovering ? Loader2 : Search}
                  size="sm"
                  className={discovering ? 'animate-spin' : undefined}
                />
                {discovering ? 'Looking up…' : 'Look up'}
              </Button>
            </div>
            {discoverError ? (
              <span className="off-set-field-err">
                <Icon icon={AlertTriangle} size="sm" />
                {discoverError}
              </span>
            ) : (
              <span className="off-field-hint">
                Paste the agent card URL (<code>.well-known/agent.json</code>).
              </span>
            )}
          </form>

          {card ? (
            <div className="off-set-preview">
              <dl className="off-set-preview-row">
                <dt>Name</dt>
                <dd>{card.name}</dd>
                <dt>Description</dt>
                <dd className="text-[length:var(--off-fs-meta)] text-[color:var(--off-ink-2)]">
                  {card.description}
                </dd>
                <dt>Brand</dt>
                <dd>
                  <span className="off-set-ext-brand">{card.brand}</span>
                </dd>
                <dt>Interfaces</dt>
                <dd className="off-mono">{card.interfaces}</dd>
                <dt>Role default</dt>
                <dd className="off-mono">{card.roleDefault}</dd>
                <dt>Endpoint</dt>
                <dd className="off-mono">{card.endpoint}</dd>
              </dl>
            </div>
          ) : null}

          {installError ? (
            <div className="off-set-err-banner">
              <Icon icon={AlertTriangle} size="sm" />
              <div>
                <div className="off-set-err-title">Connection failed</div>
                <div className="off-set-err-msg">{installError}</div>
              </div>
            </div>
          ) : null}

          <div className="off-set-dialog-actions">
            <Button
              variant="outline"
              size="md"
              disabled={connecting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button size="md" disabled={!card || connecting} onClick={() => void runConnect()}>
              <Icon
                icon={connecting ? Loader2 : Check}
                size="sm"
                className={connecting ? 'animate-spin' : undefined}
              />
              {connecting ? 'Connecting…' : 'Connect employee'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
