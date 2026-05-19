import { RackSlotService } from '@offisim/core/browser';
import type { RackWithSlots } from '@offisim/core/browser';
import { useCallback, useEffect, useState } from 'react';

import { useCompany } from '../components/company/CompanyContext.js';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context.js';

export interface UseRackSlotReturn {
  racks: RackWithSlots[];
  loading: boolean;
  createRack: (label: string, providerType: string) => Promise<string>;
  deleteRack: (rackId: string) => Promise<void>;
  bindRack: (rackId: string) => Promise<void>;
  unbindRack: (rackId: string) => Promise<void>;
  addSlot: (rackId: string, capabilityName: string, scope?: string) => Promise<string>;
  removeSlot: (slotId: string) => Promise<void>;
  refresh: () => void;
}

export function useRackSlot(): UseRackSlotReturn {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const [racks, setRacks] = useState<RackWithSlots[]>([]);
  const [loading, setLoading] = useState(true);

  const getService = useCallback(() => {
    if (!repos) throw new Error('Runtime not ready');
    return new RackSlotService(repos.racks, repos.slots, eventBus);
  }, [repos, eventBus]);

  const refresh = useCallback(async () => {
    if (!repos || !activeCompanyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const service = getService();
      const result = await service.listRacks(activeCompanyId);
      setRacks(result);
    } finally {
      setLoading(false);
    }
  }, [repos, getService, activeCompanyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRack = useCallback(
    async (label: string, providerType: string) => {
      if (!activeCompanyId) throw new Error('No active company');
      const service = getService();
      const id = await service.createRack(activeCompanyId, label, providerType);
      await refresh();
      return id;
    },
    [getService, refresh, activeCompanyId],
  );

  const deleteRack = useCallback(
    async (rackId: string) => {
      const service = getService();
      await service.deleteRack(rackId);
      await refresh();
    },
    [getService, refresh],
  );

  const bindRack = useCallback(
    async (rackId: string) => {
      const service = getService();
      await service.bindRack(rackId, {});
      await refresh();
    },
    [getService, refresh],
  );

  const unbindRack = useCallback(
    async (rackId: string) => {
      const service = getService();
      await service.unbindRack(rackId);
      await refresh();
    },
    [getService, refresh],
  );

  const addSlot = useCallback(
    async (rackId: string, capabilityName: string, scope?: string) => {
      const service = getService();
      const id = await service.addSlot(rackId, capabilityName, scope);
      await refresh();
      return id;
    },
    [getService, refresh],
  );

  const removeSlot = useCallback(
    async (slotId: string) => {
      const service = getService();
      await service.removeSlot(slotId);
      await refresh();
    },
    [getService, refresh],
  );

  return {
    racks,
    loading,
    createRack,
    deleteRack,
    bindRack,
    unbindRack,
    addSlot,
    removeSlot,
    refresh,
  };
}
