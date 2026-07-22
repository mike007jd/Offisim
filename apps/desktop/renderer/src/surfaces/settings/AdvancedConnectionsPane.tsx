import { useRegistryConnection } from '@/data/market/queries.js';
import {
  marketplaceConnectionSettings,
  writeMarketplaceBaseUrl,
  writeMarketplaceToken,
} from '@/data/market/registry-client.js';
import { queryKeys } from '@/data/query-keys.js';
import { CapsLabel, FieldRow } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { marketConnectionCopy } from '@/surfaces/market/market-presentation.js';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, KeyRound, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

function validEndpoint(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function AdvancedConnectionsPane() {
  const queryClient = useQueryClient();
  const initial = marketplaceConnectionSettings();
  const connection = useRegistryConnection();
  const copy = marketConnectionCopy(connection.data);
  const [endpoint, setEndpoint] = useState(initial.baseUrl);
  const [token, setToken] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(initial.tokenConfigured);
  const [saving, setSaving] = useState(false);

  async function refreshConnection() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.marketRegistryConnection() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.marketDrafts() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.marketListingsAll() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.marketInstalledAll() });
  }

  async function saveConnection() {
    if (!validEndpoint(endpoint)) {
      toast.error('Enter a valid connection endpoint', {
        description: 'Use an http:// or https:// URL.',
      });
      return;
    }
    setSaving(true);
    try {
      writeMarketplaceBaseUrl(endpoint);
      if (token.trim()) {
        await writeMarketplaceToken(token);
        setTokenConfigured(true);
        setToken('');
      }
      await refreshConnection();
      toast.success('Connection settings saved');
    } catch (error) {
      console.error('[AdvancedConnectionsPane] Connection settings save failed', error);
      toast.error('Connection settings not saved', {
        description:
          error instanceof Error ? error.message : 'Check the connection details and try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function clearToken() {
    setSaving(true);
    try {
      await writeMarketplaceToken(null);
      setToken('');
      setTokenConfigured(false);
      await refreshConnection();
      toast.success('Access token cleared');
    } catch (error) {
      console.error('[AdvancedConnectionsPane] Access token clear failed', error);
      toast.error('Access token not cleared', {
        description: error instanceof Error ? error.message : 'Try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="off-set-pane">
      <header className="off-set-panehead">
        <h2 className="off-set-panetitle">Service Connections</h2>
        <p className="off-set-panedesc">
          Technical connection settings for self-hosted and team services.
        </p>
      </header>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>Market catalog</CapsLabel>
            <p className="off-set-sec-hint">
              Configure the service endpoint and account token used for online browsing, publishing,
              and update checks.
            </p>
          </div>
        </div>

        <div className="off-card-block off-set-connection-card">
          <div className="off-set-connection-status">
            <Icon icon={connection.data?.connected ? CheckCircle2 : CircleAlert} size="sm" />
            <span>
              <strong>{connection.isLoading ? 'Checking connection…' : copy.title}</strong>
              <small>{connection.isLoading ? 'Reading saved settings.' : copy.description}</small>
            </span>
          </div>

          <FieldRow
            label="Endpoint"
            hint={
              initial.source === 'build' ? 'A build default is currently available.' : undefined
            }
          >
            {({ id }) => (
              <div className="off-set-ctl is-mono">
                <Icon icon={Link2} size="sm" className="off-set-ctl-lead" />
                <Input
                  id={id}
                  className="off-set-ctl-input"
                  value={endpoint}
                  placeholder="https://market.example.com"
                  spellCheck={false}
                  onChange={(event) => setEndpoint(event.currentTarget.value)}
                />
              </div>
            )}
          </FieldRow>

          <FieldRow
            label="Access token"
            hint={
              tokenConfigured
                ? 'A token is saved securely. Enter a value only to replace it.'
                : undefined
            }
          >
            {({ id }) => (
              <div className="off-set-ctl is-mono">
                <Icon icon={KeyRound} size="sm" className="off-set-ctl-lead" />
                <Input
                  id={id}
                  className="off-set-ctl-input"
                  type="password"
                  value={token}
                  autoComplete="off"
                  placeholder={tokenConfigured ? 'Saved securely' : 'Paste access token'}
                  onChange={(event) => setToken(event.currentTarget.value)}
                />
              </div>
            )}
          </FieldRow>

          <div className="off-set-connection-actions">
            {tokenConfigured ? (
              <Button
                variant="outline"
                size="md"
                onClick={() => void clearToken()}
                disabled={saving}
              >
                Clear token
              </Button>
            ) : null}
            <Button size="md" onClick={() => void saveConnection()} disabled={saving}>
              {saving ? 'Saving…' : 'Save connection'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
