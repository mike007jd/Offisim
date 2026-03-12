import type { EmployeeVersionRow, VersionDiff } from '@aics/core';
import { useCallback, useEffect, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export interface UseEmployeeVersionsReturn {
  versions: EmployeeVersionRow[];
  loading: boolean;
  diffResult: VersionDiff[] | null;
  selectedVersion: number | null;
  selectVersion: (versionNum: number | null) => void;
  rollback: (versionNum: number) => Promise<void>;
  isRollingBack: boolean;
  refresh: () => void;
}

export function useEmployeeVersions(employeeId: string | null): UseEmployeeVersionsReturn {
  const { employeeVersionService: versionService } = useAicsRuntime();

  const [versions, setVersions] = useState<EmployeeVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<VersionDiff[] | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);

  const loadVersions = useCallback(async () => {
    if (!versionService || !employeeId) {
      setVersions([]);
      return;
    }
    setLoading(true);
    try {
      const history = await versionService.getHistory(employeeId);
      setVersions(history);
    } finally {
      setLoading(false);
    }
  }, [versionService, employeeId]);

  // Load versions when employeeId changes
  useEffect(() => {
    setSelectedVersion(null);
    setDiffResult(null);
    void loadVersions();
  }, [loadVersions]);

  const selectVersion = useCallback(
    (versionNum: number | null) => {
      setSelectedVersion(versionNum);
      if (versionNum == null || !versionService || versions.length === 0) {
        setDiffResult(null);
        return;
      }

      // Compare selected version with the latest (current) version
      const selected = versions.find((v) => v.version_num === versionNum);
      const latest = versions[0]; // versions are sorted newest-first
      if (!selected || !latest || selected.version_num === latest.version_num) {
        setDiffResult(null);
        return;
      }

      const diffs = versionService.diffVersions(selected.snapshot_json, latest.snapshot_json);
      setDiffResult(diffs);
    },
    [versionService, versions],
  );

  const rollback = useCallback(
    async (versionNum: number) => {
      if (!versionService || !employeeId) return;
      setIsRollingBack(true);
      try {
        await versionService.rollbackToVersion(employeeId, versionNum);
        // Refresh the version list after rollback
        const history = await versionService.getHistory(employeeId);
        setVersions(history);
        setSelectedVersion(null);
        setDiffResult(null);
      } finally {
        setIsRollingBack(false);
      }
    },
    [versionService, employeeId],
  );

  const refresh = useCallback(() => {
    void loadVersions();
  }, [loadVersions]);

  return {
    versions,
    loading,
    diffResult,
    selectedVersion,
    selectVersion,
    rollback,
    isRollingBack,
    refresh,
  };
}
