import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Dialog, DialogContent } from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Check, Globe, Loader2, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type DiscoveredCard, discoverAgentCard } from './settings-data.js';

type Step = 'discover' | 'preview' | 'installing';

const discoverSchema = z.object({
  url: z.string().min(1, 'Agent card URL is required'),
});
type DiscoverValues = z.infer<typeof discoverSchema>;

interface ExternalEmployeeInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (card: DiscoveredCard) => Promise<void>;
}

function Stepper({ step }: { step: Step }) {
  const idx = step === 'discover' ? 0 : step === 'preview' ? 1 : 2;
  const labels = ['Discover', 'Preview', 'Install'];
  return (
    <div className="off-set-stepper">
      {labels.map((label, i) => (
        <div key={label} className="off-set-step-part">
          <span
            className={`off-set-step${i === idx ? ' is-active' : ''}${i < idx ? ' is-done' : ''}`}
          >
            <span className="off-set-step-num">
              {i < idx ? <Icon icon={Check} size="sm" /> : i + 1}
            </span>
            {i >= idx ? label : null}
          </span>
          {i < labels.length - 1 ? <span className="off-set-step-div" /> : null}
        </div>
      ))}
    </div>
  );
}

export function ExternalEmployeeInstallDialog({
  open,
  onOpenChange,
  onInstalled,
}: ExternalEmployeeInstallDialogProps) {
  const [step, setStep] = useState<Step>('discover');
  const [card, setCard] = useState<DiscoveredCard | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [installError, setInstallError] = useState(false);

  const form = useForm<DiscoverValues>({
    resolver: zodResolver(discoverSchema),
    defaultValues: { url: '' },
  });

  function reset() {
    setStep('discover');
    setCard(null);
    setDiscovering(false);
    setDiscoverError(null);
    setInstallError(false);
    form.reset({ url: '' });
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  const onDiscover = form.handleSubmit(async ({ url }) => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await discoverAgentCard(url);
      setCard(result);
      setStep('preview');
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Could not reach agent card');
    } finally {
      setDiscovering(false);
    }
  });

  async function runInstall() {
    if (!card) return;
    setStep('installing');
    setInstallError(false);
    try {
      await onInstalled(card);
      handleOpenChange(false);
    } catch {
      setInstallError(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="off-dialog-w-md" showClose={step !== 'installing'}>
        <Stepper step={step} />

        {step === 'discover' ? (
          <form onSubmit={onDiscover} className="flex flex-col gap-[var(--off-sp-5)]">
            <div className="off-field">
              <label className="off-field-label" htmlFor="ext-card-url">
                Agent card URL
              </label>
              <div className={`off-set-ctl is-mono${discoverError ? ' is-invalid' : ''}`}>
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
            </div>
            <div className="off-set-dialog-actions">
              <Button variant="outline" size="md" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={discovering}>
                <Icon
                  icon={discovering ? Loader2 : Search}
                  size="sm"
                  className={discovering ? 'animate-spin' : undefined}
                />
                Discover
              </Button>
            </div>
          </form>
        ) : null}

        {step === 'preview' && card ? (
          <div className="flex flex-col gap-[var(--off-sp-5)]">
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
            <div className="off-set-dialog-actions">
              <Button variant="outline" size="md" onClick={() => setStep('discover')}>
                Back
              </Button>
              <Button size="md" onClick={() => void runInstall()}>
                <Icon icon={Check} size="sm" />
                Connect agent
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'installing' ? (
          <div className="flex flex-col gap-[var(--off-sp-5)]">
            {!installError ? (
              <div className="off-set-install-progress">
                <div className="off-set-install-line">
                  <span className="off-set-install-ic">
                    <Icon
                      icon={Loader2}
                      size="sm"
                      className="animate-spin text-[color:var(--off-accent)]"
                    />
                  </span>
                  Connecting external employee…
                </div>
              </div>
            ) : null}
            {installError ? (
              <div className="off-set-err-banner">
                <Icon icon={AlertTriangle} size="sm" />
                <div>
                  <div className="off-set-err-title">Install failed</div>
                  <div className="off-set-err-msg">No connection was created. You can retry.</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void runInstall()}
                >
                  <Icon icon={RefreshCw} size="sm" />
                  Retry
                </Button>
              </div>
            ) : null}
            <div className="off-set-dialog-actions">
              <Button variant="outline" size="md" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
