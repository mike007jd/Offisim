import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { Progress } from '@/design-system/primitives/progress.js';
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Server,
  Shield,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { BindingSlot, MarketListing } from './market-data.js';

type Step = 'review' | 'configure' | 'installing' | 'done' | 'error';

const PROGRESS_STEPS = [
  'Loading package',
  'Reviewing manifest',
  'Configuring bindings',
  'Installing assets',
  'Complete',
] as const;

const RISK_TONE: Record<string, string> = {
  data: 'off-badge is-ok',
  logic: 'off-badge is-warn',
  system: 'off-badge is-err',
};

interface InstallDialogProps {
  listing: MarketListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: (listingId: string) => void;
}

export function InstallDialog({ listing, open, onOpenChange, onInstalled }: InstallDialogProps) {
  const [step, setStep] = useState<Step>('review');
  const [progressStep, setProgressStep] = useState(0);

  // Reset the flow each time the dialog opens for a fresh listing.
  useEffect(() => {
    if (open) {
      setStep('review');
      setProgressStep(0);
    }
  }, [open]);

  // Drive the 5-step install progress machine once we enter "installing".
  useEffect(() => {
    if (step !== 'installing') return;
    setProgressStep(0);
    const timer = window.setInterval(() => {
      setProgressStep((s) => {
        if (s >= PROGRESS_STEPS.length - 1) {
          window.clearInterval(timer);
          setStep('done');
          return s;
        }
        return s + 1;
      });
    }, 480);
    return () => window.clearInterval(timer);
  }, [step]);

  if (!listing) return null;

  const sizeClass = step === 'review' || step === 'configure' ? 'sm:max-w-[540px]' : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('off-mkt-dialog', sizeClass)} showClose={step !== 'installing'}>
        {step === 'review' ? (
          <ReviewStep
            listing={listing}
            onCancel={() => onOpenChange(false)}
            onContinue={() => setStep(listing.bindings.length > 0 ? 'configure' : 'installing')}
          />
        ) : step === 'configure' ? (
          <ConfigureStep
            bindings={listing.bindings}
            onCancel={() => onOpenChange(false)}
            onContinue={() => setStep('installing')}
          />
        ) : step === 'installing' ? (
          <InstallingStep current={progressStep} />
        ) : step === 'done' ? (
          <DoneStep
            onClose={() => {
              onInstalled(listing.id);
              onOpenChange(false);
            }}
          />
        ) : (
          <ErrorStep onClose={() => onOpenChange(false)} onRetry={() => setStep('installing')} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReviewStep({
  listing,
  onCancel,
  onContinue,
}: {
  listing: MarketListing;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const riskLabel =
    listing.permissions.risk === 'data'
      ? 'Data Asset'
      : listing.permissions.risk === 'logic'
        ? 'Logic Asset'
        : 'System Asset';
  const networkRequested = listing.permissions.network !== 'none';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review Package</DialogTitle>
        <DialogDescription>Review the package details before installing.</DialogDescription>
      </DialogHeader>
      <div className="off-mkt-dlg-body">
        <div className="off-mkt-rv-top">
          <div className="off-mkt-rv-id">
            <div className="off-mkt-rv-name">{listing.name}</div>
            <div className="off-mkt-rv-slug">
              {listing.slug} · v{listing.version}
            </div>
            <div className="off-mkt-rv-by">
              by {listing.creatorName} (@{listing.handle})
            </div>
          </div>
          <span className={RISK_TONE[listing.permissions.risk]}>{riskLabel}</span>
        </div>
        <p className="off-mkt-rv-sum">{listing.summary}</p>

        <div className="off-perm-box">
          <div className="off-perm-h">
            <Icon icon={Shield} size="sm" />
            Permissions
          </div>
          <PermRow icon={HardDrive} label="Filesystem" value={listing.permissions.filesystem} />
          <PermRow icon={Globe} label="Network" value={listing.permissions.network} />
          <PermRow icon={KeyRound} label="Secrets" value={listing.permissions.secrets} />
          <PermRow icon={Shield} label="Risk class" value={listing.permissions.risk} />
        </div>

        {listing.requirements.mcps.length > 0 ? (
          <div className="off-perm-box">
            <div className="off-perm-h">
              <Icon icon={Server} size="sm" />
              Required MCP Servers
            </div>
            {listing.requirements.mcps.map((m) => (
              <PermRow key={m} icon={Server} label={m} value="required" />
            ))}
            <div className="off-alert is-warn">
              <Icon icon={AlertTriangle} size="sm" />
              <span>Configure these MCP servers in your local runtime before installing.</span>
            </div>
          </div>
        ) : null}

        {networkRequested ? (
          <div className="off-alert is-warn">
            <Icon icon={AlertTriangle} size="sm" />
            <span>Network access requested — review before approving.</span>
          </div>
        ) : null}

        <div className="off-mkt-rv-compat">
          <span>Runtime {listing.requirements.runtime}</span>
          <span>·</span>
          <span>Schema {listing.requirements.schema}</span>
          <span>·</span>
          <span>{listing.license}</span>
        </div>
      </div>
      <DialogFooterRow>
        <Button variant="outline" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="md" onClick={onContinue}>
          Approve &amp; Continue
        </Button>
      </DialogFooterRow>
    </>
  );
}

function ConfigureStep({
  bindings,
  onCancel,
  onContinue,
}: {
  bindings: BindingSlot[];
  onCancel: () => void;
  onContinue: () => void;
}) {
  const schema = z.object(
    Object.fromEntries(
      bindings.map((b) => [
        b.id,
        b.required ? z.string().min(1, 'Required') : z.string().optional(),
      ]),
    ),
  );
  type FormShape = Record<string, string | undefined>;
  const form = useForm<FormShape>({
    resolver: zodResolver(schema) as never,
    defaultValues: Object.fromEntries(bindings.map((b) => [b.id, ''])),
  });
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});

  const submit = form.handleSubmit(() => onContinue());

  return (
    <>
      <DialogHeader>
        <DialogTitle>Configure Bindings</DialogTitle>
        <DialogDescription>
          Choose which models to use for each role. Optional bindings can be skipped.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="off-mkt-dlg-body">
        {bindings.map((b) => {
          const isSkipped = skipped[b.id];
          const err = form.formState.errors[b.id]?.message as string | undefined;
          return (
            <div key={b.id} className="off-perm-box off-bind">
              <div className="off-bind-head">
                <span className="off-bind-role">
                  {b.role}
                  {!b.required ? <span className="off-badge is-sec">optional</span> : null}
                </span>
                {!b.required ? (
                  <button
                    type="button"
                    className="off-bind-skip off-focusable"
                    onClick={() => setSkipped((s) => ({ ...s, [b.id]: !s[b.id] }))}
                  >
                    {isSkipped ? 'Configure' : 'Skip'}
                  </button>
                ) : null}
              </div>
              {!isSkipped ? (
                <>
                  <CapsLabel className="off-bind-hint">{b.hint}</CapsLabel>
                  <Input
                    placeholder="provider/model (e.g. openai/gpt-4o)"
                    {...form.register(b.id)}
                  />
                  {err ? <span className="off-bind-err">{err}</span> : null}
                  <div className="off-bind-sugg">
                    {b.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="off-bind-chip off-focusable"
                        onClick={() => form.setValue(b.id, s, { shouldValidate: true })}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
        <DialogFooterRow>
          <Button variant="outline" size="md" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" type="submit">
            Continue
          </Button>
        </DialogFooterRow>
      </form>
    </>
  );
}

function InstallingStep({ current }: { current: number }) {
  const pct = Math.round(((current + 1) / PROGRESS_STEPS.length) * 100);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Installing</DialogTitle>
      </DialogHeader>
      <div className="off-mkt-dlg-body">
        <Progress value={pct} />
        <div className="off-step-list">
          {PROGRESS_STEPS.map((label, i) => {
            const state = i < current ? 'done' : i === current ? 'active' : 'pending';
            return (
              <div key={label} className={`off-step-row is-${state}`}>
                <span className="off-step-si">
                  {state === 'done' ? (
                    <Icon icon={CheckCircle2} size="sm" />
                  ) : state === 'active' ? (
                    <Icon icon={Loader2} size="sm" className="off-spin" />
                  ) : (
                    <Icon icon={Circle} size="sm" />
                  )}
                </span>
                {label}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function DoneStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="off-mkt-result">
      <Icon icon={CheckCircle2} size="md" className="off-mkt-result-ok" />
      <div className="off-mkt-result-t">Installation Complete</div>
      <div className="off-mkt-result-d">The package has been installed successfully.</div>
      <Button size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function ErrorStep({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }) {
  return (
    <div className="off-mkt-result">
      <Icon icon={XCircle} size="md" className="off-mkt-result-err" />
      <div className="off-mkt-result-t">Installation Failed</div>
      <div className="off-mkt-result-d is-err">Artifact hash mismatch — refusing to write.</div>
      <div className="off-mkt-result-acts">
        <Button variant="outline" size="md" onClick={onClose}>
          Close
        </Button>
        <Button size="md" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

function PermRow({
  icon,
  label,
  value,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
}) {
  return (
    <div className="off-perm-row">
      <span className="off-perm-k">
        <Icon icon={icon} size="sm" />
        {label}
      </span>
      <span className="off-perm-v">{value}</span>
    </div>
  );
}

function DialogFooterRow({ children }: { children: React.ReactNode }) {
  return <div className="off-mkt-dlg-foot">{children}</div>;
}
