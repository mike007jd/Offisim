import { chromium } from 'playwright';
const baseUrl = 'http://127.0.0.1:4173/';
const timestamp = '2026-04-06T00:41:09.950Z';
const providerConfig = {
  provider: 'openai-compat',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  baseURL: 'https://example.invalid/v1',
};
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
      persona_json: '{}',
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
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(baseUrl);
await page.evaluate(
  ({ providerConfig, snapshot }) => {
    localStorage.setItem('offisim-provider-config', JSON.stringify(providerConfig));
    localStorage.setItem('offisim:browser-runtime-snapshot:v1', JSON.stringify(snapshot));
    localStorage.setItem('offisim:active-company', 'c-local-audit');
  },
  { providerConfig, snapshot },
);
await page.reload();
await page.waitForSelector('header');
await page.waitForTimeout(1200);
await page.getByRole('tab', { name: 'SOPs' }).click();
await page.getByText('Feature Delivery').first().click();
await page.waitForTimeout(1500);
console.log('batch5', await page.getByText('Batch 5').count());
console.log('drawer count', await page.locator('.fixed.inset-y-4.right-4').count());
console.log(
  'html count',
  await page.locator('body').evaluate((body) => body.innerHTML.includes('fixed inset-y-4 right-4')),
);
await browser.close();
