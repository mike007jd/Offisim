/**
 * useInstallFlow — manages install dialog state machine.
 * MVP uses mock data; Track D will replace with real InstallService calls.
 */

import { useState, useCallback, useRef } from 'react';
import type { InstallPlan } from '@aics/install-core';
import { MOCK_INSTALL_PLAN } from '../lib/install-mock.js';

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

export function useInstallFlow(): InstallFlowState & InstallFlowActions {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<InstallStep>('idle');
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindingValues, setBindingValues] = useState<Map<string, string>>(new Map());

  // Track pending timers so we can clean them up on cancel
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startFileImport = useCallback((file: File) => {
    // Validate file size
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

    // Simulate loading delay — Track D replaces with real InstallService
    timerRef.current = setTimeout(() => {
      setPlan(MOCK_INSTALL_PLAN);
      setStep('review');
      timerRef.current = null;
    }, 500);
  }, []);

  const confirmInstall = useCallback(() => {
    if (!plan) return;

    if (plan.bindings.length > 0) {
      setStep('bindings');
    } else {
      setStep('installing');
      timerRef.current = setTimeout(() => {
        setStep('done');
        timerRef.current = null;
      }, 1000);
    }
  }, [plan]);

  const submitBindings = useCallback(() => {
    setStep('installing');
    timerRef.current = setTimeout(() => {
      setStep('done');
      timerRef.current = null;
    }, 1000);
  }, []);

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
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
  }, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
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
