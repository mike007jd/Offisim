import type { EventBus } from '../events/event-bus.js';
import {
  rackBound,
  rackUnbound,
  slotAssigned,
} from '../events/event-factories.js';
import type {
  RackRepository,
  RackRow,
  SlotRepository,
  SlotRow,
} from '../runtime/repositories.js';

export interface RackWithSlots extends RackRow {
  slots: SlotRow[];
}

export class RackSlotService {
  constructor(
    private readonly rackRepo: RackRepository,
    private readonly slotRepo: SlotRepository,
    private readonly eventBus: EventBus,
  ) {}

  async createRack(
    companyId: string,
    label: string,
    providerType: string,
  ): Promise<string> {
    const rackId = `rack_${crypto.randomUUID()}`;
    await this.rackRepo.create({
      rack_id: rackId,
      company_id: companyId,
      provider_type: providerType,
      label,
      binding_profile_json: null,
      status: 'unbound',
    });
    return rackId;
  }

  async bindRack(
    rackId: string,
    _bindingProfile: Record<string, unknown>,
  ): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    await this.rackRepo.updateStatus(rackId, 'bound');
    this.eventBus.emit(rackBound(rack.company_id, rackId, rack.provider_type, rack.label));
  }

  async unbindRack(rackId: string): Promise<void> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    await this.rackRepo.updateStatus(rackId, 'unbound');
    this.eventBus.emit(rackUnbound(rack.company_id, rackId));
  }

  async addSlot(
    rackId: string,
    capabilityName: string,
    exposureScope: string = 'company',
  ): Promise<string> {
    const rack = await this.rackRepo.findById(rackId);
    if (!rack) throw new Error(`Rack not found: ${rackId}`);
    const slotId = `slot_${crypto.randomUUID()}`;
    await this.slotRepo.create({
      slot_id: slotId,
      rack_id: rackId,
      capability_name: capabilityName,
      exposure_scope: exposureScope,
      status: 'available',
    });
    this.eventBus.emit(slotAssigned(rack.company_id, slotId, rackId, capabilityName, exposureScope));
    return slotId;
  }

  async removeSlot(slotId: string): Promise<void> {
    await this.slotRepo.delete(slotId);
  }

  async getAvailableCapabilities(companyId: string): Promise<SlotRow[]> {
    const racks = await this.rackRepo.findByCompany(companyId);
    const boundRacks = racks.filter((r) => r.status === 'bound');
    const allSlots: SlotRow[] = [];
    for (const rack of boundRacks) {
      const slots = await this.slotRepo.findByRack(rack.rack_id);
      allSlots.push(...slots.filter((s) => s.status === 'available'));
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
    const slots = await this.slotRepo.findByRack(rackId);
    for (const slot of slots) {
      await this.slotRepo.delete(slot.slot_id);
    }
    await this.rackRepo.delete(rackId);
  }
}
