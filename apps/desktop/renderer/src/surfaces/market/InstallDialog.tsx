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
import { cn } from '@/lib/utils.js';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Server,
  Shield,
  XCircle,
} from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { BindingSlot, InstallBindingValues, MarketListing } from './market-data.js';

type Step = 'review' | 'configure' | 'installing' | 'done' | 'error';

const RISK_TONE: Record<string, string> = {
  data: 'off-badge is-ok',
  logic: 'off-badge is-warn',
  system: 'off-badge is-err',
};

interface InstallDialogProps {
  listing: MarketListing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall?: (listing: MarketListing, bindings: InstallBindingValues) => Promise<void>;
}

export function InstallDialog({ listing, open, onOpenChange, onInstall }: InstallDialogProps) {
  const [step, setStep] = useState<Step>('review');
  const [bindingValues, setBindingValues] = useState<InstallBindingValues>({});
  const [errorMessage, setErrorMessage] = useState('');

  // Risk-adaptive entry: a package that requests no filesystem/network/secrets
  // access, no MCP servers, and has no bindings installs in one step (straight
  // to installing). Listings with bindings (but no sensitive perms) jump to
  // Configure; only sensitive permissions surface the full Review screen.
  useLayoutEffect(() => {
    if (!open || !listing) return;
    setBindingValues({});
    setErrorMessage('');
    const perms = listing.permissions;
    const hasSensitive =
      perms.filesystem !== 'none' ||
      perms.network !== 'none' ||
      perms.secrets !== 'none' ||
      listing.requirements.mcps.length > 0;
    if (hasSensitive) {
      setStep('review');
    } else if (listing.bindings.length > 0) {
      setStep('configure');
    } else {
      void startInstall({});
    }
  }, [open, listing]);

  if (!listing) return null;

  async function startInstall(values: InstallBindingValues) {
    if (!listing) return;
    setBindingValues(values);
    if (!listing.installArtifactUrl || !onInstall) {
      setErrorMessage('Not available to install yet.');
      setStep('error');
      return;
    }

    setErrorMessage('');
    setStep('installing');
    try {
      await onInstall(listing, values);
      setStep('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Install failed.');
      setStep('error');
    }
  }

  const sizeClass = step === 'review' || step === 'configure' ? 'off-mkt-dialog-review' : '';
  const canRetry = Boolean(listing.installArtifactUrl && onInstall);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('off-mkt-dialog', sizeClass)} showClose={step !== 'installing'}>
        {step === 'review' ? (
          <ReviewStep
            listing={listing}
            onCancel={() => onOpenChange(false)}
            onContinue={() => {
              if (listing.bindings.length > 0) setStep('configure');
              else void startInstall({});
            }}
          />
        ) : step === 'configure' ? (
          <ConfigureStep
            bindings={listing.bindings}
            onCancel={() => onOpenChange(false)}
            onContinue={(values) => void startInstall(values)}
          />
        ) : step === 'installing' ? (
          <InstallingStep />
        ) : step === 'done' ? (
          <DoneStep onClose={() => onOpenChange(false)} />
        ) : (
          <ErrorStep
            message={errorMessage}
            canRetry={canRetry}
            onClose={() => onOpenChange(false)}
            onRetry={() => void startInstall(bindingValues)}
          />
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
        <DialogTitle>Install {listing.name}?</DialogTitle>
        <DialogDescription>Review what it can access before installing.</DialogDescription>
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
              <span>Set up these MCP servers first.</span>
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
          {listing.bindings.length > 0 ? 'Configure' : 'Install'}
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
  onContinue: (values: InstallBindingValues) => void;
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

  const submit = form.handleSubmit((values) => onContinue(values));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Configure Bindings</DialogTitle>
        <DialogDescription>Assign Pi model preferences to each role.</DialogDescription>
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
                  {!b.required ? <span className="off-bind-optional">optional</span> : null}
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
                  <Input placeholder="model id or preference key" {...form.register(b.id)} />
                  {err ? <span className="off-bind-err">{err}</span> : null}
                  {b.suggestions.length > 0 ? (
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
                  ) : null}
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

function InstallingStep() {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Installing</DialogTitle>
      </DialogHeader>
      <div className="off-mkt-dlg-body">
        <div className="off-step-row is-active">
          <span className="off-step-si">
            <Icon icon={Loader2} size="sm" className="off-spin" />
          </span>
          Fetching artifact and applying bindings…
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
      <div className="off-mkt-result-d">Installed.</div>
      <Button size="md" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function ErrorStep({
  message,
  canRetry,
  onClose,
  onRetry,
}: {
  message: string;
  canRetry: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="off-mkt-result">
      <Icon icon={XCircle} size="md" className="off-mkt-result-err" />
      <div className="off-mkt-result-t">Installation Failed</div>
      <div className="off-mkt-result-d is-err">{message || 'Install failed.'}</div>
      <div className="off-mkt-result-acts">
        <Button variant="outline" size="md" onClick={onClose}>
          Close
        </Button>
        {canRetry ? (
          <Button size="md" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
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
