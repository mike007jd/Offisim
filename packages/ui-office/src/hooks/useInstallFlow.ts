/**
 * useInstallFlow — manages install dialog state machine.
 * Wired to real InstallService when available; falls back to mock data otherwise.
 *
 * After successful install, emits `employee.installed` events for each new employee
 * so the renderer (SceneManager) can add them to the scene.
 */

import { employeeInstalled } from '@aics/core';
import type { BindingConfirmation, InstallPlan, SkillValidationResult } from '@aics/install-core';
import { readPackageFile } from '@aics/install-core';
import { useCallback, useRef, useState } from 'react';
import { MOCK_INSTALL_PLAN } from '../lib/install-mock.js';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

export type InstallStep =
  | 'idle'
  | 'loading'
  | 'review'
  | 'bindings'
  | 'installing'
  | 'done'
  | 'error';

export interface InstallFlowState {
  isOpen: boolean;
  step: InstallStep;
  plan: InstallPlan | null;
  error: string | null;
  bindingValues: Map<string, string>;
  /** True when importing a SKILL.md (vs .aicspkg) — affects review UI */
  isSkillImport: boolean;
  /** Soft validation warnings from skill validator */
  skillValidation: SkillValidationResult | null;
}

export interface InstallFlowActions {
  startFileImport: (file: File) => void;
  /** Start install from a marketplace deep link (listing_id + version) */
  startRegistryInstall: (listingId: string, version: string) => void;
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
  const [isSkillImport, setIsSkillImport] = useState(false);
  const [skillValidation, setSkillValidation] = useState<SkillValidationResult | null>(null);

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

  const startFileImport = useCallback(
    (file: File) => {
      // Validate file size (applies to both real and mock paths)
      if (file.size > MAX_FILE_SIZE) {
        setIsOpen(true);
        setStep('error');
        setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
        return;
      }

      // Validate file extension
      const ext = file.name.toLowerCase();
      if (!ext.endsWith('.aicspkg') && !ext.endsWith('.zip') && !ext.endsWith('.md')) {
        setIsOpen(true);
        setStep('error');
        setError('Invalid file type. Expected .aicspkg, .zip, or .md');
        return;
      }

      setIsOpen(true);
      setStep('loading');
      setPlan(null);
      setError(null);
      setBindingValues(new Map());
      setIsSkillImport(false);
      setSkillValidation(null);
      txnIdRef.current = null;

      // --- SKILL.md import path ---
      if (ext.endsWith('.md')) {
        if (!installService) {
          // Mock fallback — no real service available
          timerRef.current = setTimeout(() => {
            setPlan(MOCK_INSTALL_PLAN);
            setIsSkillImport(true);
            setStep('review');
            timerRef.current = null;
          }, 500);
          return;
        }

        (async () => {
          try {
            const text = await file.text();
            const result = await installService.importSkill(text);

            if (result.error || !result.plan) {
              setStep('error');
              setError(result.error ?? 'Skill import failed: no plan returned');
              return;
            }

            txnIdRef.current = result.installTxnId;
            setPlan(result.plan);
            setIsSkillImport(true);
            setSkillValidation(result.skillValidation ?? null);
            setStep('review');
          } catch (err) {
            setStep('error');
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
        return;
      }

      // --- Package import path (.aicspkg / .zip) ---
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
    },
    [installService],
  );

  /**
   * Start install from a marketplace deep link.
   * Fetches artifact download info from the platform API, downloads the package,
   * and feeds it into the standard file import flow.
   */
  const startRegistryInstall = useCallback(
    (listingId: string, version: string) => {
      setIsOpen(true);
      setStep('loading');
      setPlan(null);
      setError(null);
      setBindingValues(new Map());
      setIsSkillImport(false);
      setSkillValidation(null);
      txnIdRef.current = null;

      (async () => {
        try {
          // 1. Get listing detail to find the package version ID
          const platformUrl =
            import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:4100';
          const detailRes = await fetch(`${platformUrl}/v1/market/listings/${listingId}`);
          if (!detailRes.ok) {
            throw new Error(`Failed to fetch listing: ${detailRes.statusText}`);
          }
          const detail = await detailRes.json();

          // 2. Find matching version or use latest
          const versionsRes = await fetch(
            `${platformUrl}/v1/market/listings/${listingId}/versions`,
          );
          const versionsData = await versionsRes.json();
          const versions = versionsData.versions ?? [];
          const matchedVersion =
            versions.find((v: { version: string }) => v.version === version) ??
            versions[0];

          if (!matchedVersion) {
            throw new Error(`No version ${version} found for listing ${listingId}`);
          }

          // 3. Get artifact download URL
          const downloadRes = await fetch(
            `${platformUrl}/v1/install/download/${matchedVersion.package_version_id ?? matchedVersion.package_id}`,
          );
          if (!downloadRes.ok) {
            // Fallback: show review with metadata only (no binary yet)
            // This handles the case where artifact isn't uploaded to registry yet
            setPlan(MOCK_INSTALL_PLAN);
            setStep('review');
            return;
          }
          const downloadInfo = await downloadRes.json();

          // 4. Download the actual artifact
          const artifactRes = await fetch(downloadInfo.artifact_url);
          if (!artifactRes.ok) {
            throw new Error(`Failed to download artifact: ${artifactRes.statusText}`);
          }
          const blob = await artifactRes.blob();

          // 5. Feed into standard file import flow
          const file = new File([blob], `${detail.slug ?? listingId}.aicspkg`, {
            type: 'application/octet-stream',
          });

          // Reset state and re-enter through file import
          setIsOpen(false);
          startFileImport(file);
        } catch (err) {
          setStep('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [startFileImport],
  );

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
    setIsSkillImport(false);
    setSkillValidation(null);
  }, [clearTimer, installService]);

  const close = useCallback(() => {
    clearTimer();
    txnIdRef.current = null;
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
    setIsSkillImport(false);
    setSkillValidation(null);
  }, [clearTimer]);

  return {
    isOpen,
    step,
    plan,
    error,
    bindingValues,
    isSkillImport,
    skillValidation,
    startFileImport,
    startRegistryInstall,
    confirmInstall,
    submitBindings,
    setBindingValue,
    cancel,
    close,
  };
}
