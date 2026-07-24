import { useUiState } from '@/app/ui-state.js';
import { CapsLabel, CardBlock } from '@/design-system/grammar/index.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Switch } from '@/design-system/primitives/switch.js';
import { useCodexPet } from '@/surfaces/office/scene/office-companion/CodexPetProvider.js';
import { Check, PawPrint, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

/** Display-only: collapse the user's home directory prefix to `~`. */
function collapseHomePrefix(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~');
}

export function CompanionPane() {
  const enabled = useUiState((state) => state.officeCompanionEnabled);
  const setEnabled = useUiState((state) => state.setOfficeCompanionEnabled);
  const {
    atlasError,
    atlasUrl,
    catalog,
    catalogError,
    catalogLoading,
    refresh,
    selectedPet,
    selectPet,
  } = useCodexPet();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
      toast.success('Codex pets synced');
    } catch (error) {
      toast.error('Could not sync Codex pets', { description: String(error) });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="off-set-pane">
      <div className="off-set-panehead">
        <div className="off-set-panetitle">Codex Pets</div>
        <div className="off-set-panedesc">
          Offisim reads the pets already installed by Codex. It never changes those files.
        </div>
      </div>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>Local catalog</CapsLabel>
            <div className="off-set-sec-hint off-set-pet-source">
              {catalog?.sourcePath ? collapseHomePrefix(catalog.sourcePath) : '~/.codex/pets'}
            </div>
          </div>
          <Button variant="outline" size="md" disabled={refreshing} onClick={handleRefresh}>
            <Icon icon={RefreshCw} size="sm" />
            {refreshing ? 'Syncing…' : 'Sync pets'}
          </Button>
        </div>

        <CardBlock className="off-set-pet-active">
          <div
            className="off-set-pet-preview"
            style={atlasUrl ? { backgroundImage: `url(${JSON.stringify(atlasUrl)})` } : undefined}
            aria-hidden="true"
          >
            {!atlasUrl ? <Icon icon={PawPrint} size="md" /> : null}
          </div>
          <div className="off-set-pet-active-copy">
            <div className="off-set-vault-title">{selectedPet?.displayName ?? 'No Codex pet'}</div>
            <div className="off-set-vault-sub">
              {catalogLoading
                ? 'Reading the local Codex pet catalog…'
                : (selectedPet?.description ?? 'Install a Codex pet to show it in the office.')}
            </div>
            {catalogError || atlasError ? (
              <div className="off-set-pet-error">
                <Icon icon={TriangleAlert} size="sm" />
                {catalogError ?? atlasError}
              </div>
            ) : null}
          </div>
          <label className="off-set-pet-enabled" htmlFor="offisim-codex-pet-enabled">
            <span>Show in office</span>
            <Switch
              id="offisim-codex-pet-enabled"
              checked={enabled}
              disabled={!selectedPet}
              onCheckedChange={setEnabled}
            />
          </label>
        </CardBlock>
      </section>

      <section className="off-set-sec">
        <div className="off-set-sec-head">
          <div>
            <CapsLabel>Installed pets</CapsLabel>
            <div className="off-set-sec-hint">
              {catalog?.pets.length ?? 0} valid
              {catalog?.invalidEntries.length
                ? ` · ${catalog.invalidEntries.length} invalid package${catalog.invalidEntries.length === 1 ? '' : 's'} skipped`
                : ''}
            </div>
          </div>
        </div>
        <div className="off-set-pet-grid" role="radiogroup" aria-label="Codex pet">
          {catalog?.pets.map((pet) => {
            const active = pet.id === selectedPet?.id;
            return (
              <label
                key={pet.id}
                className={`off-set-pet-choice off-focusable${active ? ' is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="offisim-codex-pet"
                  value={pet.id}
                  checked={active}
                  onChange={() => selectPet(pet.id)}
                />
                <span className="off-set-pet-choice-icon">
                  <Icon icon={active ? Check : PawPrint} size="sm" />
                </span>
                <span className="off-set-pet-choice-copy">
                  <span>{pet.displayName}</span>
                  <span>{(pet.byteSize / 1_048_576).toFixed(1)} MB · Codex</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
