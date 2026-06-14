import type { EventBus } from '../events/event-bus.js';
import { rackBound, rackUnbound, slotAssigned, slotRemoved } from '../events/event-factories.js';
import {
  RACK_STATUS,
  type RackRepository,
  type RackRow,
  SLOT_STATUS,
  type SlotRepository,
  type SlotRow,
} from '../runtime/repositories.js';

export interface RackWithSlots extends RackRow {
  slots: SlotRow[];
}

export class RackSlotService {
  /**
   * @param transact Optional synchronous transaction wrapper (Drizzle/
   *   better-sqlite3 runtime). When provided, multi-row writes (deleteRack)
   *   run inside a single SQLite transaction and events are emitted only
   *   after the transaction commits. Memory/test backends omit it.
   */
  constructor(
    private readonly rackRepo: RackRepository,
    private readonly slotRepo: SlotRepository,
    private readonly eventBus: EventBus,
    private readonly transact?: <T>(fn: () => T) => T,
  ) {}

  async createRack(companyId: string, label: string, providerType: string): Promise<string> {
    const rackId = `rack_${crypto.randomUUID()}`;
    await this.rackRepo.create({
      rack_id: rackId,
      company_id: companyId,
      provider_type: providerType,
      label,
      binding_profile_json: null,
      status: RACK_STATUS.unbound,
    });
    return rackId;
  }

  async bindRack(rackId: string, _bindingProfile: Record<string, unknown>): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    await this.rackRepo.updateStatus(rackId, RACK_STATUS.bound);
    this.eventBus.emit(rackBound(rack.company_id, rackId, rack.provider_type, rack.label));
  }

  async unbindRack(rackId: string): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    await this.rackRepo.updateStatus(rackId, RACK_STATUS.unbound);
    this.eventBus.emit(rackUnbound(rack.company_id, rackId));
  }

  async addSlot(
    rackId: string,
    capabilityName: string,
    exposureScope = 'company',
  ): Promise<string> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    const slotId = `slot_${crypto.randomUUID()}`;
    await this.slotRepo.create({
      slot_id: slotId,
      rack_id: rackId,
      capability_name: capabilityName,
      exposure_scope: exposureScope,
      status: SLOT_STATUS.available,
    });
    this.eventBus.emit(
      slotAssigned(rack.company_id, slotId, rackId, capabilityName, exposureScope),
    );
    return slotId;
  }

  async removeSlot(rackId: string, slotId: string): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    const slots = await this.slotRepo.findByRack(rackId);
    const slot = slots.find((s) => s.slot_id === slotId);
    if (!slot) throw new Error(`Slot not found: ${slotId}`);
    await this.slotRepo.delete(slotId);
    this.eventBus.emit(slotRemoved(rack.company_id, slotId, rackId));
  }

  async getAvailableCapabilities(companyId: string): Promise<SlotRow[]> {
    const racks = await this.rackRepo.findByCompany(companyId);
    const boundRacks = racks.filter((r) => r.status === RACK_STATUS.bound);
    const allSlots: SlotRow[] = [];
    for (const rack of boundRacks) {
      const slots = await this.slotRepo.findByRack(rack.rack_id);
      allSlots.push(...slots.filter((s) => s.status === SLOT_STATUS.available));
    }
    return allSlots;
  }

  async listRacks(companyId: string): Promise<RackWithSlots[]> {
    const racks = await this.rackRepo.findByCompany(companyId);
    const result: RackWithSlots[] = [];
    for (const rack of racks) {
      const slots = await this.slotRepo.findByRack(rack.rack_id);
      result.push({ ...rack, slots });
    }
    return result;
  }

  async deleteRack(rackId: string): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    // Pre-fetch slots outside the transaction so the sync transact callback
    // only contains writes (no awaits / no microtask suspension).
    const slots = await this.slotRepo.findByRack(rackId);

    if (this.transact) {
      // ── Drizzle path: slot + rack deletions in one transaction ──────────
      // Collect events and emit them only after the transaction commits.
      this.transact(() => {
        for (const slot of slots) {
          void this.slotRepo.delete(slot.slot_id);
        }
        void this.rackRepo.delete(rackId);
      });
    } else {
      // ── Async/memory-repos path ─────────────────────────────────────────
      for (const slot of slots) {
        await this.slotRepo.delete(slot.slot_id);
      }
      await this.rackRepo.delete(rackId);
    }

    for (const slot of slots) {
      this.eventBus.emit(slotRemoved(rack.company_id, slot.slot_id, rackId));
    }
  }
}
