import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';
import { RackSlotService } from '../services/rack-slot-service.js';
import { InMemoryEventBus } from '../events/event-bus.js';

describe('RackSlotService', () => {
  function setup() {
    const repos = createMemoryRepositories();
    const eventBus = new InMemoryEventBus();
    const service = new RackSlotService(repos.racks, repos.slots, eventBus);
    return { repos, eventBus, service };
  }

  it('creates a rack and returns ID', async () => {
    const { service } = setup();
    const id = await service.createRack('c-1', 'GitHub MCP', 'mcp_server');
    expect(id).toBeTruthy();
    expect(id.startsWith('rack_')).toBe(true);
  });

  it('lists racks with slots', async () => {
    const { service } = setup();
    const rackId = await service.createRack('c-1', 'GitHub', 'mcp_server');
    await service.addSlot(rackId, 'read_file', 'company');
    await service.addSlot(rackId, 'write_file', 'private');

    const racks = await service.listRacks('c-1');
    expect(racks).toHaveLength(1);
    expect(racks[0]!.slots).toHaveLength(2);
    expect(racks[0]!.label).toBe('GitHub');
  });

  it('binds and unbinds rack', async () => {
    const { service, repos } = setup();
    const rackId = await service.createRack('c-1', 'Test', 'mcp_server');
    await service.bindRack(rackId, { url: 'http://localhost' });

    const rack = await repos.racks.findById(rackId);
    expect(rack!.status).toBe('bound');

    await service.unbindRack(rackId);
    const unbound = await repos.racks.findById(rackId);
    expect(unbound!.status).toBe('unbound');
  });

  it('getAvailableCapabilities only returns slots from bound racks', async () => {
    const { service } = setup();
    const rack1 = await service.createRack('c-1', 'Bound', 'mcp_server');
    const rack2 = await service.createRack('c-1', 'Unbound', 'mcp_server');

    await service.bindRack(rack1, {});
    await service.addSlot(rack1, 'tool_a', 'company');
    await service.addSlot(rack2, 'tool_b', 'company');

    const caps = await service.getAvailableCapabilities('c-1');
    expect(caps).toHaveLength(1);
    expect(caps[0]!.capability_name).toBe('tool_a');
  });

  it('addSlot throws for nonexistent rack', async () => {
    const { service } = setup();
    await expect(service.addSlot('nonexistent', 'tool', 'company')).rejects.toThrow('Rack not found');
  });

  it('deleteRack removes rack and its slots', async () => {
    const { service } = setup();
    const rackId = await service.createRack('c-1', 'Test', 'mcp_server');
    await service.addSlot(rackId, 'tool_a', 'company');
    await service.addSlot(rackId, 'tool_b', 'company');

    await service.deleteRack(rackId);
    const racks = await service.listRacks('c-1');
    expect(racks).toHaveLength(0);
  });

  it('isolates racks by company', async () => {
    const { service } = setup();
    await service.createRack('c-1', 'Rack A', 'mcp_server');
    await service.createRack('c-2', 'Rack B', 'mcp_server');
    expect(await service.listRacks('c-1')).toHaveLength(1);
    expect(await service.listRacks('c-2')).toHaveLength(1);
  });
});
