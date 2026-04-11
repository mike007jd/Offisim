import { describe, expect, it } from 'vitest';
import { decideSopSelectionAction } from '../../components/sop/SopViewSurface';

describe('decideSopSelectionAction', () => {
  it('is noop when no SOP is selected', () => {
    expect(
      decideSopSelectionAction({
        selectedId: null,
        loading: false,
        sopIds: ['sop-a'],
        confirmedId: null,
      }),
    ).toBe('noop');
  });

  it('is noop while loading', () => {
    expect(
      decideSopSelectionAction({
        selectedId: 'sop-a',
        loading: true,
        sopIds: [],
        confirmedId: null,
      }),
    ).toBe('noop');
  });

  it('confirms when the selected id exists in sops', () => {
    expect(
      decideSopSelectionAction({
        selectedId: 'sop-a',
        loading: false,
        sopIds: ['sop-a', 'sop-b'],
        confirmedId: null,
      }),
    ).toBe('confirm');
  });

  it('is noop on first render with empty sops — never observed the id', () => {
    // Regression: first-frame (useSops initial loading=false, sops=[]) must
    // not fire a deletion toast, because the id has never been confirmed.
    expect(
      decideSopSelectionAction({
        selectedId: 'sop-a',
        loading: false,
        sopIds: [],
        confirmedId: null,
      }),
    ).toBe('noop');
  });

  it('is noop under StrictMode double-run — confirmedId still null on second run', () => {
    // Regression: the old bug seeded prevSelectedIdRef with selectedSopId,
    // so StrictMode's double-invoke made the second run fire the toast. The
    // new contract: without a prior confirmation, toast never fires, so
    // StrictMode's repeated run lands on `'noop'` twice.
    const args = {
      selectedId: 'sop-a',
      loading: false,
      sopIds: [] as readonly string[],
      confirmedId: null,
    };
    expect(decideSopSelectionAction(args)).toBe('noop');
    expect(decideSopSelectionAction(args)).toBe('noop');
  });

  it('fires toast-and-reset when a previously-confirmed id disappears', () => {
    expect(
      decideSopSelectionAction({
        selectedId: 'sop-a',
        loading: false,
        sopIds: ['sop-b'],
        confirmedId: 'sop-a',
      }),
    ).toBe('toast-and-reset');
  });
});
