/**
 * useInstallFlow — manages install dialog state machine.
 * Wired to real InstallService when available; falls back to mock data otherwise.
 *
 * After successful install, emits `employee.installed` events for each new employee
 * so the renderer (SceneManager) can add them to the scene.
 */

import { useState, useCallback, useRef } from 'react';
import type { InstallPlan, BindingConfirmation } from '@aics/install-core';
import { readPackageFile } from '@aics/install-core';
import { employeeInstalled } from '@aics/core';
import { MOCK_INSTALL_PLAN } from '../lib/install-mock.js';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

export type InstallStep = 'idle' | 'loading' | 'review' | 'bindings' | 'installing' | 'done' | 'error';

export interface InstallFlowState {
  isOpen: boolean;
  step: InstallStep;
  plan: InstallPlan | null;
  error: string | null;
  bindingValues: Map<string, string>;
}

export interface InstallFlowActions {
  startFileImport: (file: File) => void;
  confirmInstall: () => void;
  submitBindings: () => void;
  setBindingValue: (key: string, value: string) => void;
  cancel: () => void;
  close: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const COMPANY_ID = 'company-001';

export function useInstallFlow(): InstallFlowState & InstallFlowActions {
  const { installService, eventBus } = useAicsRuntime();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<InstallStep>('idle');
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindingValues, setBindingValues] = useState<Map<string, string>>(new Map());

  // Track the active transaction ID for cancel / confirm operations
  const txnIdRef = useRef<string | null>(null);

  // Track pending timers so we can clean them up on cancel (mock fallback)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * After a successful install, emit employeeInstalled events so
   * SceneManager can add the new employees to the PixiJS scene.
   */
  const emitInstalledEmployees = useCallback(
    (employeeIds: string[], activePlan: InstallPlan, txnId: string) => {
      for (const empId of employeeIds) {
        eventBus.emit(
          employeeInstalled(
            COMPANY_ID,
            empId,
            activePlan.manifest.package.title,
            txnId,
            activePlan.manifest.package.id,
          ),
        );
      }
    },
    [eventBus],
  );

  const startFileImport = useCallback((file: File) => {
    // Validate file size (applies to both real and mock paths)
    if (file.size > MAX_FILE_SIZE) {
      setIsOpen(true);
      setStep('error');
      setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
      return;
    }

    // Validate file extension
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.aicspkg') && !ext.endsWith('.zip')) {
      setIsOpen(true);
      setStep('error');
      setError('Invalid file type. Expected .aicspkg or .zip');
      return;
    }

    setIsOpen(true);
    setStep('loading');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
    txnIdRef.current = null;

    if (!installService) {
      // Mock fallback — no real service available
      timerRef.current = setTimeout(() => {
        setPlan(MOCK_INSTALL_PLAN);
        setStep('review');
        timerRef.current = null;
      }, 500);
      return;
    }

    // Real path: read file bytes and call InstallService.importFile
    (async () => {
      try {
        const bytes = await readPackageFile(file);
        const result = await installService.importFile(bytes);

        if (result.error || !result.plan) {
          setStep('error');
          setError(result.error ?? 'Import failed: no plan returned');
          return;
        }

        txnIdRef.current = result.installTxnId;
        setPlan(result.plan);
        setStep('review');
      } catch (err) {
        setStep('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [installService]);

  const confirmInstall = useCallback(() => {
    if (!plan) return;

    if (plan.bindings.length > 0) {
      setStep('bindings');
      return;
    }

    // No bindings needed — proceed to install directly
    if (!installService || !txnIdRef.current) {
      // Mock fallback
      setStep('installing');
      timerRef.current = setTimeout(() => {
        setStep('done');
        timerRef.current = null;
      }, 1000);
      return;
    }

    // Real path: confirm with empty bindings
    const currentTxnId = txnIdRef.current;
    const currentPlan = plan;
    setStep('installing');
    (async () => {
      try {
        const result = await installService.confirmBindings(currentTxnId, []);
        emitInstalledEmployees(result.employeeIds, currentPlan, currentTxnId);
        setStep('done');
      } catch (err) {
        setStep('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [plan, installService, emitInstalledEmployees]);

  const submitBindings = useCallback(() => {
    if (!installService || !txnIdRef.current || !plan) {
      // Mock fallback
      setStep('installing');
      timerRef.current = setTimeout(() => {
        setStep('done');
        timerRef.current = null;
      }, 1000);
      return;
    }

    // Build BindingConfirmation[] from the plan's binding requirements + user values
    const confirmations: BindingConfirmation[] = plan.bindings
      .filter((req) => bindingValues.has(req.bindingKey))
      .map((req) => ({
        bindingKey: req.bindingKey,
        bindingType: req.bindingType,
        valueJson: JSON.stringify(bindingValues.get(req.bindingKey)),
      }));

    const currentTxnId = txnIdRef.current;
    const currentPlan = plan;
    setStep('installing');
    (async () => {
      try {
        const result = await installService.confirmBindings(currentTxnId, confirmations);
        emitInstalledEmployees(result.employeeIds, currentPlan, currentTxnId);
        setStep('done');
      } catch (err) {
        setStep('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [installService, plan, bindingValues, emitInstalledEmployees]);

  const setBindingValue = useCallback((key: string, value: string) => {
    setBindingValues((prev) => {
      const next = new Map(prev);
      if (value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  }, []);

  const cancel = useCallback(() => {
    clearTimer();

    // If there's an active transaction and a real service, cancel it
    if (installService && txnIdRef.current) {
      const txnId = txnIdRef.current;
      installService.cancel(txnId).catch((err) => {
        console.warn('[useInstallFlow] cancel failed:', err);
      });
    }

    txnIdRef.current = null;
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
  }, [clearTimer, installService]);

  const close = useCallback(() => {
    clearTimer();
    txnIdRef.current = null;
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
  }, [clearTimer]);

  return {
    isOpen,
    step,
    plan,
    error,
    bindingValues,
    startFileImport,
    confirmInstall,
    submitBindings,
    setBindingValue,
    cancel,
    close,
  };
}
