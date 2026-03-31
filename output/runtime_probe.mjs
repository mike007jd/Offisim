import { chromium } from '@playwright/test';

const url = process.env.OFFISIM_URL ?? 'http://localhost:5179/';

const providerConfig = {
  provider: process.env.OFFISIM_PROVIDER ?? 'anthropic',
  apiKey: process.env.OFFISIM_API_KEY ?? '',
  baseURL: process.env.OFFISIM_BASE_URL ?? 'https://api.minimax.io/anthropic',
  model: process.env.OFFISIM_MODEL ?? 'MiniMax-M2.7-highspeed',
};

async function waitForRuntime(page) {
  await page.waitForFunction(() => typeof window.__OFFISIM_DEBUG__ !== 'undefined', {
    timeout: 15000,
  });
}

async function injectProvider(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((cfg) => {
    localStorage.setItem('offisim-provider-config', JSON.stringify(cfg));
  }, providerConfig);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRuntime(page);
}

async function sendMessage(page, text) {
  const input = page.getByPlaceholder('Send a message...');
  await input.fill(text);
  await input.locator('..').locator('button').click();
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
  await browser.close();
}
