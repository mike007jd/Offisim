import { CapsLabel, CardBlock } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { type AppUpdateStatus, invokeCommand } from '@/lib/tauri-commands.js';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  Terminal,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

function statusIcon(status: AppUpdateStatus['status']) {
  if (status === 'available') return Download;
  if (status === 'current') return CheckCircle2;
  if (status === 'gh-missing' || status === 'gh-auth-required') return Terminal;
  return TriangleAlert;
}

export function UpdatePane() {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  const check = useCallback(async (showSuccess = false) => {
    setChecking(true);
    try {
      const next = await invokeCommand('app_update_check');
      setStatus(next);
      if (showSuccess && next.status === 'current') toast.success('Offisim is up to date');
    } catch (error) {
      toast.error('Could not check for updates', { description: String(error) });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  async function install() {
    setInstalling(true);
    try {
      await invokeCommand('app_update_install');
    } catch (error) {
      setInstalling(false);
      toast.error('Could not install update', { description: String(error) });
    }
  }

  const StatusIcon = status ? statusIcon(status.status) : RefreshCw;
  const needsGh = status?.status === 'gh-missing' || status?.status === 'gh-auth-required';

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">App updates</div>
        <div className="off-set-panedesc">
          Updates come from the private Offisim GitHub repository through your existing GitHub CLI
          login. Offisim never reads, copies, or stores its token.
        </div>
      </div>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>Release channel</CapsLabel>
            <div className="off-set-sec-hint">Signed and notarized macOS releases</div>
          </div>
          <Button
            variant="outline"
            size="md"
            disabled={checking || installing}
            onClick={() => void check(true)}
          >
            <Icon icon={RefreshCw} size="sm" />
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>

        <CardBlock className={`off-set-update-card is-${status?.status ?? 'checking'}`}>
          <div className="off-set-update-icon">
            <Icon icon={StatusIcon} size="md" />
          </div>
          <div className="off-set-update-copy">
            <strong>
              {status?.status === 'available'
                ? `Offisim ${status.latestVersion} is ready`
                : status?.status === 'current'
                  ? 'You have the latest Offisim'
                  : needsGh
                    ? 'GitHub CLI setup required'
                    : status
                      ? 'Update check unavailable'
                      : 'Checking release status…'}
            </strong>
            <p>{status?.message ?? 'Reading the latest private release metadata…'}</p>
          </div>
          {status?.status === 'available' ? (
            <Button size="md" disabled={installing} onClick={() => void install()}>
              <Icon icon={Download} size="sm" />
              {installing ? 'Installing…' : 'Install and restart'}
            </Button>
          ) : null}
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <CapsLabel>Installed version</CapsLabel>
        <dl className="off-set-update-meta off-card-block">
          <div>
            <dt>Current</dt>
            <dd>{status?.currentVersion ?? 'Reading…'}</dd>
          </div>
          <div>
            <dt>Latest</dt>
            <dd>{status?.latestVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>{status?.releaseTag ?? '—'}</dd>
          </div>
          <div>
            <dt>GitHub CLI</dt>
            <dd>{status?.ghPath ?? 'Not found'}</dd>
          </div>
        </dl>
      </section>

      {needsGh ? (
        <section className="off-set-sec">
          <CapsLabel>Setup</CapsLabel>
          <div className="off-card-block off-set-update-help">
            <p>
              Install GitHub CLI yourself, then run <code>gh auth login</code> in Terminal. Offisim
              deliberately does not install tools or request a token.
            </p>
            <Button variant="outline" size="sm" asChild>
              <a href="https://cli.github.com/" target="_blank" rel="noreferrer">
                GitHub CLI instructions <ExternalLink size={14} />
              </a>
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
