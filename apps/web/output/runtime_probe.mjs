import { chromium } from '@playwright/test';

const url = process.env.OFFISIM_URL ?? 'http://localhost:5179/';

const providerConfig = {
  provider: process.env.OFFISIM_PROVIDER ?? 'anthropic',
  apiKey: process.env.OFFISIM_API_KEY ?? '',
  baseURL: process.env.OFFISIM_BASE_URL ?? 'https://api.minimax.io/anthropic',
  model: process.env.OFFISIM_MODEL ?? 'MiniMax-M2.7-highspeed',
};

const now = new Date().toISOString();
const seededCompanyId = process.env.OFFISIM_COMPANY_ID ?? 'c-test-1';
const seededSnapshot = {
  companies: [
    {
      company_id: seededCompanyId,
      name: 'Probe Corp',
      status: 'active',
      template_id: null,
      template_label: null,
      workspace_root: null,
      default_model_policy_json: JSON.stringify({
        default: {
          profileName: 'probe',
          provider: providerConfig.provider,
          model: providerConfig.model,
          temperature: 0.7,
          maxTokens: 4096,
        },
      }),
      created_at: now,
      updated_at: now,
    },
  ],
  employees: [
    {
      employee_id: 'e-mgr-1',
      company_id: seededCompanyId,
      source_asset_id: null,
      source_package_id: null,
      name: 'Manager Bot',
      role_slug: 'manager',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'project management' }),
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      employee_id: 'e-dev-1',
      company_id: seededCompanyId,
      source_asset_id: null,
      source_package_id: null,
      name: 'Dev Bot',
      role_slug: 'developer',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'TypeScript', tone: 'concise' }),
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
  ],
};

async function waitForRuntime(page) {
  await page.waitForFunction(() => typeof window.__OFFISIM_DEBUG__ !== 'undefined', {
    timeout: 15000,
  });
}

async function injectProvider(page) {
  console.log('STEP inject:start');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ cfg, snapshot, companyId }) => {
      localStorage.setItem('offisim-provider-config', JSON.stringify(cfg));
      localStorage.setItem('offisim:browser-runtime-snapshot:v1', JSON.stringify(snapshot));
      localStorage.setItem('offisim:active-company', companyId);
    },
    { cfg: providerConfig, snapshot: seededSnapshot, companyId: seededCompanyId },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRuntime(page);
  console.log('STEP inject:ready');
}

async function sendMessage(page, text) {
  console.log('STEP send:locate-input');
  const input = page.getByPlaceholder('Message your team...');
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(text);
  await input.locator('..').locator('button').click();
  console.log('STEP send:clicked');
}

async function lastAssistantText(page) {
  await page.locator('[data-role="assistant"]').first().waitFor({
    state: 'visible',
    timeout: 60000,
  });
  return (await page.locator('[data-role="assistant"]').last().textContent()) ?? '';
}

async function snapshotState(page) {
  return page.evaluate(() => {
    const snapshotRaw = localStorage.getItem('offisim:browser-runtime-snapshot:v1');
    const eventsRaw = localStorage.getItem('offisim:browser-event-history:v1');
    return {
      snapshot: snapshotRaw ? JSON.parse(snapshotRaw) : null,
      events: eventsRaw ? JSON.parse(eventsRaw) : [],
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await injectProvider(page);
  await sendMessage(page, process.env.OFFISIM_MESSAGE ?? 'Reply with exactly: OFFISIM_OK');
  const assistant = await lastAssistantText(page);
  const state = await snapshotState(page);

  console.log(
    JSON.stringify(
      {
        assistant,
        snapshotKeys: state.snapshot ? Object.keys(state.snapshot) : null,
        eventCount: state.events.length,
        lastEvents: state.events.slice(-10).map((event) => event.type),
      },
      null,
      2,
    ),
  );
} finally {
  await page.screenshot({ path: 'output/runtime_probe.png', fullPage: true }).catch(() => {});
  await browser.close();
}
