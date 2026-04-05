import { type Page, expect } from '@playwright/test';
import { ONBOARDING_STORAGE_KEY } from '../../src/lib/onboarding-store';

const STORAGE_KEY = 'offisim-provider-config';
const RUNTIME_SNAPSHOT_KEY = 'offisim:browser-runtime-snapshot:v1';
const ACTIVE_COMPANY_KEY = 'offisim:active-company';
const EVENT_HISTORY_KEY = 'offisim:browser-event-history:v1';

export interface TestProviderConfig {
  provider: 'anthropic';
  apiKey: string;
  baseURL: string;
  model: string;
}

function buildProviderConfig(): TestProviderConfig {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error(
      'MINIMAX_API_KEY not found in environment. ' +
        'E2E requires a live MiniMax key in .env.local at the repo root. ' +
        'Set MINIMAX_API_KEY=sk-... before running `pnpm test:e2e`.',
    );
  }
  return {
    provider: 'anthropic',
    apiKey,
    baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
    model: process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7-highspeed',
  };
}

// NOTE: injectProvider alone does NOT work on a truly fresh profile. Without an
// offisim:active-company key, main.tsx mounts BootstrapProvider instead of
// OffisimRuntimeProvider and the __OFFISIM_DEBUG__ bridge never appears. Use
// seedTestCompanyAndProvider for specs that require a working runtime.
export async function injectProvider(page: Page): Promise<void> {
  const config = buildProviderConfig();

  await page.goto('/');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: JSON.stringify(config),
  });
  await page.reload();
}

// Seed shape mirrors apps/web/output/runtime_probe.mjs (manually verified against
// MiniMax). Keep the two in sync if MemoryRepositoriesSnapshot fields change.
export async function seedTestCompanyAndProvider(
  page: Page,
  options: { companyId?: string; templateId?: string } = {},
): Promise<void> {
  const config = buildProviderConfig();
  const companyId = options.companyId ?? 'c-e2e-onboarding';
  const templateId = options.templateId ?? 'ai-startup';
  const now = new Date().toISOString();

  const snapshot = {
    companies: [
      {
        company_id: companyId,
        name: 'E2E Test Co',
        status: 'active',
        template_id: templateId,
        template_label: null,
        workspace_root: null,
        default_model_policy_json: JSON.stringify({
          default: {
            profileName: 'e2e',
            provider: config.provider,
            model: config.model,
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
        company_id: companyId,
        source_asset_id: null,
        source_package_id: null,
        name: 'Alex Manager',
        role_slug: 'manager',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'project management' }),
        config_json: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      },
      {
        employee_id: 'e-writer-1',
        company_id: companyId,
        source_asset_id: null,
        source_package_id: null,
        name: 'Sam Writer',
        role_slug: 'writer',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'copywriting and brand voice' }),
        config_json: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      },
    ],
  };

  await page.goto('/');
  await page.evaluate(
    ({ providerKey, providerValue, snapshotKey, snapshotValue, companyKey, companyIdValue }) => {
      localStorage.setItem(providerKey, providerValue);
      localStorage.setItem(snapshotKey, snapshotValue);
      localStorage.setItem(companyKey, companyIdValue);
    },
    {
      providerKey: STORAGE_KEY,
      providerValue: JSON.stringify(config),
      snapshotKey: RUNTIME_SNAPSHOT_KEY,
      snapshotValue: JSON.stringify(snapshot),
      companyKey: ACTIVE_COMPANY_KEY,
      companyIdValue: companyId,
    },
  );
  await page.reload();
}

export async function clearAllTestState(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ keys }) => {
      for (const k of keys) localStorage.removeItem(k);
    },
    {
      keys: [
        STORAGE_KEY,
        ONBOARDING_STORAGE_KEY,
        RUNTIME_SNAPSHOT_KEY,
        ACTIVE_COMPANY_KEY,
        EVENT_HISTORY_KEY,
      ],
    },
  );
}

export async function resetOnboardingState(page: Page): Promise<void> {
  await page.evaluate((key) => {
    localStorage.removeItem(key);
  }, ONBOARDING_STORAGE_KEY);
}

export async function readOnboardingState(page: Page): Promise<{
  account: Record<string, boolean>;
  companies: Record<string, Record<string, boolean>>;
}> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { account: {}, companies: {} };
    try {
      return JSON.parse(raw) as {
        account: Record<string, boolean>;
        companies: Record<string, Record<string, boolean>>;
      };
    } catch {
      return { account: {}, companies: {} };
    }
  }, ONBOARDING_STORAGE_KEY);
}

export async function waitForRuntime(page: Page): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
  await page.waitForFunction(() => (window as any).__OFFISIM_DEBUG__ !== undefined, {
    timeout: 15_000,
  });
}

// Drawer defaults to open on desktop (>768px viewport). Only click toggle on the
// rare case it was closed by a prior test run.
export async function openChat(page: Page): Promise<void> {
  const placeholder = page.getByPlaceholder('Message your team...');
  if (await placeholder.isVisible().catch(() => false)) return;

  const toggle = page.getByRole('button', { name: /^Chat$/ });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
  }
  await expect(placeholder).toBeVisible({ timeout: 5_000 });
}

export async function sendChat(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder('Message your team...');
  await input.fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
}

export async function waitForResponse(page: Page, timeout = 45_000): Promise<string> {
  await page.locator('[data-role="assistant"]').first().waitFor({
    state: 'visible',
    timeout,
  });
  const responseBubble = page.locator('[data-role="assistant"]').last();
  const text = await responseBubble.textContent();
  return text ?? '';
}
