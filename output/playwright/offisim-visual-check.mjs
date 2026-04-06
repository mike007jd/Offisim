import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4173/';
const timestamp = '2026-04-06T00:41:09.950Z';
const providerConfig = {
  provider: 'openai-compat',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  baseURL: 'https://example.invalid/v1',
};
const eventHistory = [
  {
    type: 'employee.state.changed',
    entityId: 'e-mgr-1',
    entityType: 'employee',
    companyId: 'c-local-audit',
    timestamp: Date.parse('2026-04-06T00:44:00.000Z'),
    payload: {
      employeeId: 'e-mgr-1',
      employeeName: 'Alex Manager',
      prev: 'assigned',
      next: 'idle',
    },
  },
  {
    type: 'task.state.changed',
    entityId: 'task-feed-1',
    entityType: 'task',
    companyId: 'c-local-audit',
    timestamp: Date.parse('2026-04-06T00:45:00.000Z'),
    payload: {
      prev: 'queued',
      next: 'executing',
    },
  },
  {
    type: 'error.occurred',
    entityId: 'boss',
    entityType: 'employee',
    companyId: 'c-local-audit',
    timestamp: Date.parse('2026-04-06T00:46:00.000Z'),
    payload: {
      errorCode: 'RATE_LIMIT',
      message:
        'Provider retry queue exceeded the current budget, so execution paused until the next approval window opens.',
      nodeName: 'boss',
    },
  },
];
const sopDefinition = {
  sop_id: 'sop-feature-delivery',
  name: 'Feature Delivery',
  description: 'Ship a feature from brief to QA.',
  created_at: timestamp,
  steps: [
    {
      step_id: 's1',
      label: 'Brief',
      role_slug: 'manager',
      instruction: 'Clarify scope',
      dependencies: [],
      output_key: 'brief',
    },
    {
      step_id: 's2',
      label: 'Design',
      role_slug: 'designer',
      instruction: 'Prepare design',
      dependencies: ['s1'],
      output_key: 'design',
    },
    {
      step_id: 's3',
      label: 'Build',
      role_slug: 'developer',
      instruction: 'Implement',
      dependencies: ['s2'],
      output_key: 'build',
    },
    {
      step_id: 's4',
      label: 'Review',
      role_slug: 'manager',
      instruction: 'Review work',
      dependencies: ['s3'],
      output_key: 'review',
    },
    {
      step_id: 's5',
      label: 'QA',
      role_slug: 'researcher',
      instruction: 'Verify outcome',
      dependencies: ['s4'],
      output_key: 'qa',
    },
  ],
};
const snapshot = {
  companies: [
    {
      company_id: 'c-local-audit',
      name: 'Audit Co',
      status: 'active',
      template_id: 'ai-startup',
      template_label: null,
      workspace_root: null,
      default_model_policy_json: JSON.stringify({
        default: {
          profileName: 'audit',
          provider: providerConfig.provider,
          model: providerConfig.model,
          temperature: 0.7,
          maxTokens: 4096,
        },
      }),
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
  employees: [
    {
      employee_id: 'e-mgr-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Alex Manager',
      role_slug: 'manager',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'project management' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      employee_id: 'e-writer-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Sam Writer',
      role_slug: 'writer',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'copywriting' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      employee_id: 'e-dev-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Jamie Dev',
      role_slug: 'developer',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'frontend implementation' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      employee_id: 'e-research-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Taylor Research',
      role_slug: 'researcher',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'verification' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      employee_id: 'e-design-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Riley Design',
      role_slug: 'designer',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'interaction design' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      employee_id: 'e-ops-1',
      company_id: 'c-local-audit',
      source_asset_id: null,
      source_package_id: null,
      name: 'Morgan Ops',
      role_slug: 'manager',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'runtime operations' }),
      config_json: null,
      enabled: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
  sopTemplates: [
    {
      sop_template_id: 'sop-template-feature-delivery',
      company_id: 'c-local-audit',
      name: 'Feature Delivery',
      description: 'Ship a feature from brief to QA.',
      definition_json: JSON.stringify(sopDefinition),
      source_thread_id: null,
      source_url: null,
      version: '1',
      last_synced_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
};

async function seed(page) {
  await page.goto(baseUrl);
  await page.evaluate(
    ({ providerConfig, snapshot, eventHistory }) => {
      localStorage.setItem('offisim-provider-config', JSON.stringify(providerConfig));
      localStorage.setItem('offisim:browser-runtime-snapshot:v1', JSON.stringify(snapshot));
      localStorage.setItem('offisim:browser-event-history:v1', JSON.stringify(eventHistory));
      localStorage.setItem('offisim:active-company', 'c-local-audit');
      localStorage.removeItem('offisim.panel.left');
      localStorage.removeItem('offisim.panel.right');
      localStorage.removeItem('offisim-chat-open');
      localStorage.removeItem('offisim-chat-height');
      localStorage.removeItem('offisim-chat-compact');
    },
    { providerConfig, snapshot, eventHistory },
  );
  await page.reload();
  await page.waitForSelector('header');
  await page.waitForTimeout(1200);
}

const browser = await chromium.launch({ headless: true });

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await seed(desktop);
assert.ok(await desktop.getByRole('button', { name: 'Collapse personnel panel' }).isVisible());
assert.ok(await desktop.getByRole('button', { name: 'Collapse operations panel' }).isVisible());
assert.ok(await desktop.getByRole('tab', { name: 'SOPs' }).isVisible());
assert.equal(await desktop.getByTitle('Layout Editor').count(), 0);
assert.ok(await desktop.getByTitle('Decoration Studio').isVisible());
const zoneLabelBoxes = await desktop.locator('[data-zone-label]').evaluateAll((nodes) =>
  nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      label: node.getAttribute('data-zone-label'),
      centerX: rect.x + rect.width / 2,
      width: rect.width,
    };
  }),
);
for (const box of zoneLabelBoxes) {
  assert.ok(
    box.centerX >= 280 && box.centerX <= 1440 - 280,
    `Zone label ${box.label} should stay inside the visible scene gutter`,
  );
}

await desktop.getByRole('tab', { name: 'SOPs' }).click();
await desktop.getByText('Feature Delivery').first().click();
await desktop.waitForSelector('text=Batch 5');
const drawerBox = await desktop.locator('.fixed.inset-y-4.right-4').boundingBox();
assert.ok(
  drawerBox && drawerBox.width >= 780,
  'SOP drawer should be wide enough for the full timeline',
);
assert.ok(
  await desktop.getByText('Batch 5').isVisible(),
  'Later SOP batches should be visible without hidden truncation',
);

await desktop.locator('button[aria-label^="Notifications"]').click();
await desktop.waitForSelector('text=Notifications');
await desktop.mouse.click(40, 140);
await desktop.waitForTimeout(250);
assert.equal(await desktop.locator('text=Notifications').count(), 0);

const chatInput = desktop.getByPlaceholder('Message your team...');
const inputBox = await chatInput.boundingBox();
assert.ok(inputBox, 'chat input should have a bounding box');
assert.ok(inputBox.y + inputBox.height <= 900, 'chat input should remain inside the viewport');
await desktop.screenshot({ path: 'output/playwright/ui-regression-desktop.png', fullPage: false });

await desktop.locator('button[aria-label="Settings"]').click();
await desktop.waitForSelector('text=Settings');
await desktop.locator('#settings-api-key').fill('sk-test');
await desktop.mouse.click(20, 20);
await desktop.waitForTimeout(250);
assert.ok(
  await desktop.locator('text=Settings').isVisible(),
  'Settings should stay open on outside click',
);
await desktop.getByRole('tab', { name: 'Runtime Policy' }).click();
assert.ok(await desktop.getByText('Default Model Profile').isVisible());
assert.ok(await desktop.getByRole('button', { name: 'Save Runtime Policy' }).isVisible());
await desktop.keyboard.press('Escape');

await desktop.getByRole('tab', { name: 'Events' }).click();
assert.ok(
  await desktop
    .getByText(
      'Provider retry queue exceeded the current budget, so execution paused until the next approval window opens.',
    )
    .isVisible(),
);
await desktop.screenshot({ path: 'output/playwright/ui-regression-events.png', fullPage: false });

await desktop.getByText('Alex Manager').first().click();
await desktop.waitForSelector('[data-testid="employee-inspector"]');
assert.ok(await desktop.getByText('Available for the next assignment.').isVisible());
assert.ok(await desktop.getByRole('button', { name: 'Edit Profile' }).isVisible());
await desktop.screenshot({
  path: 'output/playwright/ui-regression-inspector.png',
  fullPage: false,
});

const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await seed(tablet);
assert.ok(await tablet.getByRole('button', { name: 'Collapse personnel panel' }).isVisible());
assert.ok(await tablet.getByRole('button', { name: 'Expand operations panel' }).isVisible());
await tablet.screenshot({ path: 'output/playwright/ui-regression-tablet.png', fullPage: false });

await browser.close();
console.log('visual-check:ok');
