import {
  DEFAULT_WIZARD_FORM,
  WIZARD_STEPS,
  initialWizardState,
  isStepValid,
  wizardReducer,
} from '@aics/ui-office';
import type { WizardAction, WizardState } from '@aics/ui-office';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function applyActions(state: WizardState, actions: WizardAction[]): WizardState {
  return actions.reduce((s, a) => wizardReducer(s, a), state);
}

// ---------------------------------------------------------------------------
// Reducer: next / back / goto
// ---------------------------------------------------------------------------
describe('wizardReducer — navigation', () => {
  it('advances to next step', () => {
    const s = wizardReducer(initialWizardState, { type: 'next' });
    expect(s.currentStep).toBe(1);
  });

  it('marks previous step as completed on next', () => {
    const s = wizardReducer(initialWizardState, { type: 'next' });
    expect(s.completedSteps.has(0)).toBe(true);
  });

  it('does not go past the last step', () => {
    let state = initialWizardState;
    for (let i = 0; i < WIZARD_STEPS.length + 3; i++) {
      state = wizardReducer(state, { type: 'next' });
    }
    expect(state.currentStep).toBe(WIZARD_STEPS.length - 1);
  });

  it('goes back one step', () => {
    const s1 = wizardReducer(initialWizardState, { type: 'next' });
    const s2 = wizardReducer(s1, { type: 'back' });
    expect(s2.currentStep).toBe(0);
  });

  it('does not go below step 0', () => {
    const s = wizardReducer(initialWizardState, { type: 'back' });
    expect(s.currentStep).toBe(0);
  });

  it('goto jumps to a completed step', () => {
    // Go to step 3, then goto step 1 (which is completed)
    const state = applyActions(initialWizardState, [
      { type: 'next' },
      { type: 'next' },
      { type: 'next' },
    ]);
    expect(state.currentStep).toBe(3);
    const jumped = wizardReducer(state, { type: 'goto', step: 1 });
    expect(jumped.currentStep).toBe(1);
  });

  it('goto refuses to jump to an uncompleted future step', () => {
    const state = applyActions(initialWizardState, [{ type: 'next' }]);
    // Currently on step 1; try to jump to step 5 which is not completed
    const attempted = wizardReducer(state, { type: 'goto', step: 5 });
    expect(attempted.currentStep).toBe(1); // unchanged
  });

  it('goto ignores out-of-range steps', () => {
    const s1 = wizardReducer(initialWizardState, { type: 'goto', step: -1 });
    expect(s1.currentStep).toBe(0);

    const s2 = wizardReducer(initialWizardState, { type: 'goto', step: 100 });
    expect(s2.currentStep).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reducer: updateField
// ---------------------------------------------------------------------------
describe('wizardReducer — updateField', () => {
  it('updates a string field', () => {
    const s = wizardReducer(initialWizardState, {
      type: 'updateField',
      key: 'name',
      value: 'Alice',
    });
    expect(s.formData.name).toBe('Alice');
  });

  it('updates a numeric field', () => {
    const s = wizardReducer(initialWizardState, {
      type: 'updateField',
      key: 'temperature',
      value: 1.2,
    });
    expect(s.formData.temperature).toBe(1.2);
  });

  it('preserves other fields when updating one', () => {
    const s = wizardReducer(initialWizardState, {
      type: 'updateField',
      key: 'name',
      value: 'Bob',
    });
    expect(s.formData.role_slug).toBe(DEFAULT_WIZARD_FORM.role_slug);
    expect(s.formData.temperature).toBe(DEFAULT_WIZARD_FORM.temperature);
  });
});

// ---------------------------------------------------------------------------
// Reducer: reset
// ---------------------------------------------------------------------------
describe('wizardReducer — reset', () => {
  it('resets to initial state', () => {
    const modified = applyActions(initialWizardState, [
      { type: 'updateField', key: 'name', value: 'Test' },
      { type: 'next' },
      { type: 'next' },
    ]);
    const resetted = wizardReducer(modified, { type: 'reset' });
    expect(resetted.currentStep).toBe(0);
    expect(resetted.formData.name).toBe('');
    expect(resetted.completedSteps.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isStepValid
// ---------------------------------------------------------------------------
describe('isStepValid', () => {
  it('role step: valid when role_slug is non-empty', () => {
    expect(isStepValid(0, { ...DEFAULT_WIZARD_FORM, role_slug: 'developer' })).toBe(true);
    expect(isStepValid(0, { ...DEFAULT_WIZARD_FORM, role_slug: '' })).toBe(false);
  });

  it('name step: valid when name is non-empty', () => {
    expect(isStepValid(1, { ...DEFAULT_WIZARD_FORM, name: 'Alice' })).toBe(true);
    expect(isStepValid(1, { ...DEFAULT_WIZARD_FORM, name: '' })).toBe(false);
    expect(isStepValid(1, { ...DEFAULT_WIZARD_FORM, name: '   ' })).toBe(false);
  });

  it('expertise step: valid when expertise is non-empty', () => {
    expect(isStepValid(2, { ...DEFAULT_WIZARD_FORM, expertise: 'React' })).toBe(true);
    expect(isStepValid(2, { ...DEFAULT_WIZARD_FORM, expertise: '' })).toBe(false);
  });

  it('style step: valid when style is non-empty', () => {
    expect(isStepValid(3, { ...DEFAULT_WIZARD_FORM, style: 'Collaborative' })).toBe(true);
    expect(isStepValid(3, { ...DEFAULT_WIZARD_FORM, style: '' })).toBe(false);
  });

  it('instructions step: always valid (optional)', () => {
    expect(isStepValid(4, DEFAULT_WIZARD_FORM)).toBe(true);
    expect(isStepValid(4, { ...DEFAULT_WIZARD_FORM, customInstructions: 'Do X' })).toBe(true);
  });

  it('model step: always valid (optional)', () => {
    expect(isStepValid(5, DEFAULT_WIZARD_FORM)).toBe(true);
  });

  it('preview step: always valid', () => {
    expect(isStepValid(6, DEFAULT_WIZARD_FORM)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Progress calculation
// ---------------------------------------------------------------------------
describe('progress calculation', () => {
  it('computes progress as (currentStep + 1) / total', () => {
    const total = WIZARD_STEPS.length;

    const s0 = initialWizardState;
    expect((s0.currentStep + 1) / total).toBeCloseTo(1 / total);

    const s3 = applyActions(initialWizardState, [
      { type: 'next' },
      { type: 'next' },
      { type: 'next' },
    ]);
    expect((s3.currentStep + 1) / total).toBeCloseTo(4 / total);

    let sLast = initialWizardState;
    for (let i = 0; i < total - 1; i++) {
      sLast = wizardReducer(sLast, { type: 'next' });
    }
    expect((sLast.currentStep + 1) / total).toBeCloseTo(1);
  });
});
