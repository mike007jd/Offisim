import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../runtime/memory-repositories.js';

describe('MemoryOfficeLayoutRepository', () => {
  it('creates and retrieves layout', async () => {
    const repos = createMemoryRepositories();
    const layout = await repos.officeLayouts.create({
      layout_id: 'layout-1',
      company_id: 'c-1',
      name: 'Default',
      layout_json: JSON.stringify({ gridCols: 2, gridRows: 2, workstations: [] }),
      is_active: 1,
    });
    expect(layout.layout_id).toBe('layout-1');
    expect(layout.name).toBe('Default');

    const found = await repos.officeLayouts.findById('layout-1');
    expect(found).not.toBeNull();
  });

  it('findActive returns active layout', async () => {
    const repos = createMemoryRepositories();
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'A',
      layout_json: '{}',
      is_active: 0,
    });
    await repos.officeLayouts.create({
      layout_id: 'l-2',
      company_id: 'c-1',
      name: 'B',
      layout_json: '{}',
      is_active: 1,
    });

    const active = await repos.officeLayouts.findActive('c-1');
    expect(active).not.toBeNull();
    expect(active?.layout_id).toBe('l-2');
  });

  it('setActive deactivates others', async () => {
    const repos = createMemoryRepositories();
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'A',
      layout_json: '{}',
      is_active: 1,
    });
    await repos.officeLayouts.create({
      layout_id: 'l-2',
      company_id: 'c-1',
      name: 'B',
      layout_json: '{}',
      is_active: 0,
    });

    await repos.officeLayouts.setActive('c-1', 'l-2');

    const l1 = await repos.officeLayouts.findById('l-1');
    const l2 = await repos.officeLayouts.findById('l-2');
    expect(l1?.is_active).toBe(0);
    expect(l2?.is_active).toBe(1);
  });

  it('updates layout name and json', async () => {
    const repos = createMemoryRepositories();
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'Old',
      layout_json: '{}',
      is_active: 1,
    });
    await repos.officeLayouts.update('l-1', { name: 'New', layout_json: '{"updated":true}' });

    const found = await repos.officeLayouts.findById('l-1');
    expect(found?.name).toBe('New');
    expect(found?.layout_json).toBe('{"updated":true}');
  });

  it('deletes layout', async () => {
    const repos = createMemoryRepositories();
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'A',
      layout_json: '{}',
      is_active: 0,
    });
    await repos.officeLayouts.delete('l-1');
    expect(await repos.officeLayouts.findById('l-1')).toBeNull();
  });

  it('findByCompany returns only matching company', async () => {
    const repos = createMemoryRepositories();
    await repos.officeLayouts.create({
      layout_id: 'l-1',
      company_id: 'c-1',
      name: 'A',
      layout_json: '{}',
      is_active: 1,
    });
    await repos.officeLayouts.create({
      layout_id: 'l-2',
      company_id: 'c-2',
      name: 'B',
      layout_json: '{}',
      is_active: 1,
    });

    expect(await repos.officeLayouts.findByCompany('c-1')).toHaveLength(1);
  });
});
