/**
 * useInstallFlow — manages install dialog state machine.
 *
 * After successful install, emits `employee.installed` events for each new employee
 * so scene views can add them to the display.
 */

import { employeeInstalled } from '@offisim/core/browser';
import type {
  BindingConfirmation,
  InstallImportOptions,
  InstallPlan,
  SkillValidationResult,
  UpgradeDiff,
} from '@offisim/install-core';
import { computeUpgradeDiff, readPackageFile } from '@offisim/install-core';
import { RegistryApiError } from '@offisim/registry-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntime } from '../runtime/offisim-runtime-context.js';
import { useRegistryClient } from './useRegistryClient.js';

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
  /** True when importing a SKILL.md (vs .offisimpkg) — affects review UI */
  isSkillImport: boolean;
  /** Soft validation warnings from skill validator */
  skillValidation: SkillValidationResult | null;
  /** Non-null when this is an upgrade — contains the diff for UpgradePreview */
  upgradeDiff: UpgradeDiff | null;
}

export interface InstallFlowActions {
  startFileImport: (file: File, options?: InstallImportOptions) => void;
  /** Start install from a marketplace deep link (listing_id + version) */
  startRegistryInstall: (listingId: string, version: string) => void;
  /**
   * Start an upgrade flow. Provide the currently installed manifest so the
   * dialog can compute and show a diff before confirming.
   */
  startUpgrade: (
    file: File,
    currentManifest: import('@offisim/asset-schema').PackageManifest,
  ) => void;
  confirmInstall: () => void;
  submitBindings: () => void;
  setBindingValue: (key: string, value: string) => void;
  cancel: () => void;
  close: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const PENDING_INSTALL_INTENT_KEY = 'offisim:pending-install-intent:v1';
/** Drop persisted intents older than 10 minutes — user has moved on. */
const PENDING_INSTALL_INTENT_TTL_MS = 10 * 60 * 1000;

interface PendingInstallIntent {
  listingId: string;
  version: string;
  storedAt: number;
}

function readPendingInstallIntent(): PendingInstallIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INSTALL_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInstallIntent>;
    if (
      typeof parsed.listingId !== 'string' ||
      typeof parsed.version !== 'string' ||
      typeof parsed.storedAt !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.storedAt > PENDING_INSTALL_INTENT_TTL_MS) {
      window.sessionStorage.removeItem(PENDING_INSTALL_INTENT_KEY);
      return null;
    }
    return parsed as PendingInstallIntent;
  } catch {
    return null;
  }
}

function clearPendingInstallIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_INSTALL_INTENT_KEY);
  } catch {
    /* noop */
  }
}

export function useInstallFlow(): InstallFlowState & InstallFlowActions {
  const { installService, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const registryClient = useRegistryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<InstallStep>('idle');
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bindingValues, setBindingValues] = useState<Map<string, string>>(new Map());
  const [isSkillImport, setIsSkillImport] = useState(false);
  const [skillValidation, setSkillValidation] = useState<SkillValidationResult | null>(null);
  const [upgradeDiff, setUpgradeDiff] = useState<UpgradeDiff | null>(null);

  // Ref for the current manifest (used during upgrade to compute diff after plan is ready)
  const currentManifestRef = useRef<import('@offisim/asset-schema').PackageManifest | null>(null);

  // Track the active transaction ID for cancel / confirm operations
  const txnIdRef = useRef<string | null>(null);

  // Guard against setter calls after unmount / cancel
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * After a successful install, emit employeeInstalled events so
   * scene views can add the new employees to the display.
   */
  const emitInstalledEmployees = useCallback(
    (employeeIds: string[], activePlan: InstallPlan, txnId: string) => {
      if (!activeCompanyId) return;
      for (const empId of employeeIds) {
        eventBus.emit(
          employeeInstalled(
            activeCompanyId,
            empId,
            activePlan.manifest.package.title,
            txnId,
            activePlan.manifest.package.id,
          ),
        );
      }
    },
    [activeCompanyId, eventBus],
  );

  const beginPackageImport = useCallback(
    async (bytes: Uint8Array, options?: InstallImportOptions) => {
      if (!installService) {
        // Defensive — entrypoints fail fast before reaching here.
        setStep('error');
        setError('Install requires an LLM provider. Configure a provider in Settings first.');
        return;
      }

      const result = await installService.importFile(bytes, options);

      if (result.error || !result.plan) {
        setStep('error');
        setError(result.error ?? 'Import failed: no plan returned');
        return;
      }

      txnIdRef.current = result.installTxnId;
      setPlan(result.plan);
      setStep('review');
    },
    [installService],
  );

  const startFileImport = useCallback(
    (file: File, options?: InstallImportOptions) => {
      // Validate file size (applies to both real and mock paths)
      if (file.size > MAX_FILE_SIZE) {
        setIsOpen(true);
        setStep('error');
        setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
        return;
      }

      // Validate file extension
      const ext = file.name.toLowerCase();
      if (!ext.endsWith('.offisimpkg') && !ext.endsWith('.zip') && !ext.endsWith('.md')) {
        setIsOpen(true);
        setStep('error');
        setError('Invalid file type. Expected .offisimpkg, .zip, or .md');
        return;
      }

      // Fail fast before reading file bytes if no provider is configured.
      if (!installService) {
        setIsOpen(true);
        setStep('error');
        setError('Install requires an LLM provider. Configure a provider in Settings first.');
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
        (async () => {
          try {
            const text = await file.text();
            if (!mountedRef.current) return;
            const result = await installService.importSkill(text);
            if (!mountedRef.current) return;

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
            if (!mountedRef.current) return;
            setStep('error');
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
        return;
      }

      // --- Package import path (.offisimpkg / .zip) ---
      (async () => {
        try {
          const bytes = await readPackageFile(file);
          if (!mountedRef.current) return;
          await beginPackageImport(bytes, options);
        } catch (err) {
          if (!mountedRef.current) return;
          setStep('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [beginPackageImport, installService],
  );

  /**
   * Start an upgrade flow. The currentManifest is used to compute an UpgradeDiff
   * which the UI shows via UpgradePreview instead of ManifestReview.
   */
  const startUpgrade = useCallback(
    (file: File, currentManifest: import('@offisim/asset-schema').PackageManifest) => {
      currentManifestRef.current = currentManifest;
      setUpgradeDiff(null);

      // Intercept the plan result to compute diff
      const originalStartFileImport = () => {
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          setIsOpen(true);
          setStep('error');
          setError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
          return;
        }

        const ext = file.name.toLowerCase();
        if (!ext.endsWith('.offisimpkg') && !ext.endsWith('.zip')) {
          setIsOpen(true);
          setStep('error');
          setError('Upgrade only supports .offisimpkg or .zip packages');
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

        if (!installService) {
          setStep('error');
          setError('Install requires an LLM provider. Configure a provider in Settings first.');
          return;
        }

        (async () => {
          try {
            const bytes = await readPackageFile(file);
            if (!mountedRef.current) return;
            const result = await installService.importFile(bytes);
            if (!mountedRef.current) return;

            if (result.error || !result.plan) {
              setStep('error');
              setError(result.error ?? 'Import failed: no plan returned');
              return;
            }

            txnIdRef.current = result.installTxnId;
            setPlan(result.plan);
            setUpgradeDiff(computeUpgradeDiff(currentManifest, result.plan.manifest));
            setStep('review');
          } catch (err) {
            if (!mountedRef.current) return;
            setStep('error');
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      };

      originalStartFileImport();
    },
    [installService],
  );

  /**
   * Start install from a marketplace deep link.
   * Uses RegistryClient to fetch listing/version/download info, downloads the
   * package artifact, and feeds it into the standard file import flow.
   */
  const startRegistryInstall = useCallback(
    (listingId: string, version: string) => {
      // Prevent concurrent installs — if a transaction is already active, ignore.
      if (txnIdRef.current) return;

      // Fail fast before any network work if no provider is configured.
      // Persist the pending intent so that once the user configures a
      // provider the runtime reinit can replay it automatically (see
      // consumePendingInstallIntent below).
      if (!installService) {
        try {
          if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(
              PENDING_INSTALL_INTENT_KEY,
              JSON.stringify({ listingId, version, storedAt: Date.now() }),
            );
          }
        } catch {
          /* sessionStorage unavailable — intent is lost, user sees error below */
        }
        setIsOpen(true);
        setStep('error');
        setError(
          'Install requires an LLM provider. Configure a provider in Settings — the install will resume automatically.',
        );
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

      (async () => {
        try {
          // 1. Get listing detail (provides slug for filename)
          const detail = await registryClient.getListingDetail(listingId);
          if (!mountedRef.current) return;

          // 2. List versions and find the requested one (or fall back to latest)
          const versionsResponse = await registryClient.listListingVersions(listingId);
          if (!mountedRef.current) return;
          const versions = versionsResponse.versions;
          const matchedVersion = versions.find((v) => v.version === version) ?? versions[0];

          if (!matchedVersion) {
            setStep('error');
            setError(`Version ${version} not found for listing ${listingId}`);
            return;
          }

          // 3. Get artifact download info
          const packageVersionId = matchedVersion.package_version_id ?? matchedVersion.package_id;
          if (!packageVersionId) {
            setStep('error');
            setError(`Version ${version} is missing a downloadable package reference`);
            return;
          }
          const downloadInfo = await registryClient.getArtifactDownloadInfo(packageVersionId);
          if (!mountedRef.current) return;

          // 4. Validate artifact URL protocol before fetching
          try {
            const parsedUrl = new URL(downloadInfo.artifact_url);
            if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
              setStep('error');
              setError(`Unsafe artifact URL protocol: ${parsedUrl.protocol}`);
              return;
            }
          } catch {
            setStep('error');
            setError('Invalid artifact URL');
            return;
          }

          // 5. Download the actual artifact
          const artifactRes = await fetch(downloadInfo.artifact_url);
          if (!mountedRef.current) return;
          if (!artifactRes.ok) {
            setStep('error');
            setError(`Failed to download package: ${artifactRes.statusText}`);
            return;
          }
          const blob = await artifactRes.blob();
          if (!mountedRef.current) return;

          // 6. Feed into standard file import flow
          const file = new File([blob], `${detail.slug ?? listingId}.offisimpkg`, {
            type: 'application/octet-stream',
          });
          const options: InstallImportOptions = {
            sourceType: 'registry',
            sourceRef: listingId,
            targetPackageId: matchedVersion.package_id ?? null,
            targetVersion: matchedVersion.version,
            descriptor: {
              listing_id: listingId,
              package_version_id: packageVersionId,
            },
          };

          const bytes = await readPackageFile(file);
          if (!mountedRef.current) return;
          await beginPackageImport(bytes, options);
          clearPendingInstallIntent();
        } catch (err) {
          if (!mountedRef.current) return;
          if (err instanceof RegistryApiError) {
            if (err.status === 404) {
              setError('Listing not found — it may have been removed from the marketplace');
            } else if (err.status === 410) {
              setError('Version not available — this version has been retired');
            } else {
              setError(`Registry error (${err.code}): ${err.message}`);
            }
          } else if (err instanceof TypeError) {
            // fetch() throws TypeError on network failure
            setError('Network error — check your connection and try again');
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
          setStep('error');
        }
      })();
    },
    [beginPackageImport, installService, registryClient],
  );

  // When installService flips from null → non-null (user configured a
  // provider and the runtime reinitialized), replay any pending deep-link
  // install intent stored in sessionStorage.
  useEffect(() => {
    if (!installService) return;
    const pending = readPendingInstallIntent();
    if (!pending) return;
    clearPendingInstallIntent();
    startRegistryInstall(pending.listingId, pending.version);
  }, [installService, startRegistryInstall]);

  const confirmInstall = useCallback(() => {
    if (!plan) return;

    if (plan.bindings.length > 0) {
      setStep('bindings');
      return;
    }

    // No bindings needed — proceed to install directly
    if (!installService || !txnIdRef.current) {
      setStep('error');
      setError('Install runtime disconnected — please retry after the runtime reloads');
      return;
    }

    // Real path: confirm with empty bindings
    const currentTxnId = txnIdRef.current;
    const currentPlan = plan;
    setStep('installing');
    (async () => {
      try {
        const result = await installService.confirmBindings(currentTxnId, []);
        if (!mountedRef.current) return;
        emitInstalledEmployees(result.employeeIds, currentPlan, currentTxnId);
        setStep('done');
      } catch (err) {
        if (!mountedRef.current) return;
        setStep('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [plan, installService, emitInstalledEmployees]);

  const submitBindings = useCallback(() => {
    if (!installService || !txnIdRef.current || !plan) {
      setStep('error');
      setError('Install runtime disconnected — please retry after the runtime reloads');
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
        if (!mountedRef.current) return;
        emitInstalledEmployees(result.employeeIds, currentPlan, currentTxnId);
        setStep('done');
      } catch (err) {
        if (!mountedRef.current) return;
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
    // If there's an active transaction and a real service, cancel it
    if (installService && txnIdRef.current) {
      const txnId = txnIdRef.current;
      installService.cancel(txnId).catch((err) => {
        console.warn('[useInstallFlow] cancel failed:', err);
      });
    }

    txnIdRef.current = null;
    currentManifestRef.current = null;
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
    setIsSkillImport(false);
    setSkillValidation(null);
    setUpgradeDiff(null);
  }, [installService]);

  const close = useCallback(() => {
    txnIdRef.current = null;
    currentManifestRef.current = null;
    setIsOpen(false);
    setStep('idle');
    setPlan(null);
    setError(null);
    setBindingValues(new Map());
    setIsSkillImport(false);
    setSkillValidation(null);
    setUpgradeDiff(null);
  }, []);

  return {
    isOpen,
    step,
    plan,
    error,
    bindingValues,
    isSkillImport,
    skillValidation,
    upgradeDiff,
    startFileImport,
    startRegistryInstall,
    startUpgrade,
    confirmInstall,
    submitBindings,
    setBindingValue,
    cancel,
    close,
  };
}
