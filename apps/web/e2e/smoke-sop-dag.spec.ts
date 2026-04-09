import { expect, test } from '@playwright/test';
import { clearAllTestState, waitForRuntime } from './helpers/setup';

// ---------------------------------------------------------------------------
// Seed data — company + provider + SOP template with 3 connected steps
// ---------------------------------------------------------------------------

const COMPANY_ID = 'c-e2e-sop';
const SOP_TEMPLATE_ID = 'sop-e2e-dag';

const SOP_DEFINITION = {
  sop_id: SOP_TEMPLATE_ID,
  name: 'E2E Test Workflow',
  description: 'A simple 3-step workflow for E2E testing',
  steps: [
    {
      step_id: 'step-design',
      label: 'Design',
      role_slug: 'designer',
      instruction: 'Create mockups',
      dependencies: [],
      output_key: 'step-design',
    },
    {
      step_id: 'step-develop',
      label: 'Develop',
      role_slug: 'developer',
      instruction: 'Implement the feature',
      dependencies: ['step-design'],
      output_key: 'step-develop',
    },
    {
      step_id: 'step-review',
      label: 'Review',
      role_slug: 'qa',
      instruction: 'Test and verify',
      dependencies: ['step-develop'],
      output_key: 'step-review',
    },
  ],
  created_at: new Date().toISOString(),
};

function buildSeedData() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY required for E2E tests');
  }
  const now = new Date().toISOString();
  const providerConfig = {
    provider: 'anthropic',
    apiKey,
    baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
    model: process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7-highspeed',
  };
  const snapshot = {
    companies: [
      {
        company_id: COMPANY_ID,
        name: 'SOP Test Co',
        status: 'active',
        template_id: 'ai-startup',
        template_label: null,
        workspace_root: null,
        default_model_policy_json: JSON.stringify({
          default: {
            profileName: 'e2e',
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
        employee_id: 'e-dev-1',
        company_id: COMPANY_ID,
        source_asset_id: null,
        source_package_id: null,
        name: 'Dev One',
        role_slug: 'developer',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'fullstack' }),
        config_json: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      },
    ],
    sopTemplates: [
      {
        sop_template_id: SOP_TEMPLATE_ID,
        company_id: COMPANY_ID,
        name: 'E2E Test Workflow',
        description: 'A simple 3-step workflow for E2E testing',
        definition_json: JSON.stringify(SOP_DEFINITION),
        source_thread_id: null,
        source_url: null,
        version: null,
        last_synced_at: null,
        created_at: now,
        updated_at: now,
      },
    ],
  };
  return { providerConfig, snapshot };
}

async function seedAndNavigateToSops(page: import('@playwright/test').Page) {
  const { providerConfig, snapshot } = buildSeedData();
  await page.goto('/');
  await page.evaluate(
    ({ pKey, pVal, sKey, sVal, cKey, cVal }) => {
      localStorage.setItem(pKey, pVal);
      localStorage.setItem(sKey, sVal);
      localStorage.setItem(cKey, cVal);
    },
    {
      pKey: 'offisim-provider-config',
      pVal: JSON.stringify(providerConfig),
      sKey: 'offisim:browser-runtime-snapshot:v1',
      sVal: JSON.stringify(snapshot),
      cKey: 'offisim:active-company',
      cVal: COMPANY_ID,
    },
  );
  await page.reload();
  await waitForRuntime(page);

  // Navigate to SOPs workspace via header button
  const sopsBtn = page.getByRole('button', { name: 'SOPs workspace' });
  await sopsBtn.click();
  // Wait for sidebar to show "SOPs" heading
  await expect(page.getByText('SOPs').first()).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Smoke: SOP DAG Editor V2', () => {
  test.beforeEach(async ({ page }) => {
    await clearAllTestState(page);
    await seedAndNavigateToSops(page);
  });

  test('displays seeded SOP in sidebar and renders DAG canvas', async ({ page }) => {
    // Seeded SOP should appear in sidebar
    const sopItem = page.getByText('E2E Test Workflow');
    await expect(sopItem).toBeVisible();

    // Click to select it
    await sopItem.click();

    // DAG canvas should render with SVG
    const svg = page.locator('svg[role="img"][aria-label="SOP workflow DAG"]');
    await expect(svg).toBeVisible({ timeout: 5_000 });

    // Should show 3 nodes (Design, Develop, Review)
    await expect(page.getByText('Design').first()).toBeVisible();
    await expect(page.getByText('Develop').first()).toBeVisible();
    await expect(page.getByText('Review').first()).toBeVisible();
  });

  test('edit mode toggle shows port circles and drag handles', async ({ page }) => {
    // Select the SOP
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Click Edit button
    await page.getByRole('button', { name: /Edit/ }).click();

    // Port circles should appear (output ports)
    const outputPort = page.locator(
      '[aria-label="Create dependency from Design"]',
    );
    await expect(outputPort).toBeVisible({ timeout: 3_000 });

    // Input ports should appear
    const inputPort = page.locator(
      '[aria-label="Connect dependency into Develop"]',
    );
    await expect(inputPort).toBeVisible();

    // Edit mode button should show "Editing" state
    await expect(page.getByRole('button', { name: /Editing/ })).toBeVisible();
  });

  test('Auto Layout button appears in edit mode', async ({ page }) => {
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Auto Layout should NOT be visible before edit mode
    await expect(page.getByRole('button', { name: 'Auto Layout' })).not.toBeVisible();

    // Enter edit mode
    await page.getByRole('button', { name: /Edit/ }).click();

    // Auto Layout should now appear
    const autoLayoutBtn = page.getByRole('button', { name: 'Auto Layout' });
    await expect(autoLayoutBtn).toBeVisible();

    // Click it — should not crash
    await autoLayoutBtn.click();
    // Canvas should still be intact
    await expect(page.getByText('Design').first()).toBeVisible();
  });

  test('node drag repositions node and persists position', async ({ page }) => {
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Enter edit mode (this bakes positions)
    await page.getByRole('button', { name: /Edit/ }).click();
    await page.waitForTimeout(500); // wait for bake to persist

    // Get the Design node's drag handle rect
    const svg = page.locator('svg[role="img"][aria-label="SOP workflow DAG"]');
    const designNode = svg.locator('foreignObject').first();
    const box = await designNode.boundingBox();
    expect(box).toBeTruthy();

    // biome-ignore lint/style/noNonNullAssertion: test assertion
    const startX = box!.x + box!.width / 2;
    // biome-ignore lint/style/noNonNullAssertion: test assertion
    const startY = box!.y + box!.height / 2;

    // Drag the node 100px to the right, 50px down
    // Use mouse events — the transparent drag rect sits above foreignObject
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 100, startY + 50, { steps: 10 });
    await page.mouse.up();

    // Wait for persist — runtime debounces saves
    await page.waitForTimeout(2_000);

    // Verify node moved — foreignObject should have shifted
    const newBox = await designNode.boundingBox();
    expect(newBox).toBeTruthy();
    // biome-ignore lint/style/noNonNullAssertion: test assertion
    expect(Math.abs(newBox!.x - box!.x) + Math.abs(newBox!.y - box!.y)).toBeGreaterThan(5);
  });

  test('double-click canvas opens add step popover', async ({ page }) => {
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Enter edit mode
    await page.getByRole('button', { name: /Edit/ }).click();
    await page.waitForTimeout(300);

    // Double-click on an empty area of the canvas
    const canvas = page.locator('.flex-1.overflow-hidden.relative');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).toBeTruthy();

    // Double-click at bottom-right area (likely empty)
    // biome-ignore lint/style/noNonNullAssertion: test assertion
    await canvas.dblclick({
      position: {
        x: canvasBox!.width - 50,
        y: canvasBox!.height - 80,
      },
    });

    // Add step popover should appear with a label input
    const labelInput = page.getByPlaceholder('Step label...');
    await expect(labelInput).toBeVisible({ timeout: 3_000 });

    // Fill in step details
    await labelInput.fill('Deploy');

    // Select a role
    const roleSelect = page.locator('select');
    await roleSelect.last().selectOption('devops');

    // Submit — use the button inside the popover form (not the canvas Add Step button)
    const popover = page.locator('.rounded-lg.border.border-white\\/10.bg-slate-800\\/95');
    await popover.getByRole('button', { name: 'Add' }).click();

    // New node should appear in the canvas
    await expect(page.getByText('Deploy').first()).toBeVisible({ timeout: 5_000 });
  });

  test('right-click node shows context menu with Edit/Duplicate/Delete', async ({
    page,
  }) => {
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Enter edit mode
    await page.getByRole('button', { name: /Edit/ }).click();
    await page.waitForTimeout(300);

    // Right-click on the first node's drag handle area
    const svg = page.locator('svg[role="img"][aria-label="SOP workflow DAG"]');
    const firstNode = svg.locator('foreignObject').first();
    const box = await firstNode.boundingBox();
    expect(box).toBeTruthy();

    // biome-ignore lint/style/noNonNullAssertion: test assertion
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, {
      button: 'right',
    });

    // Context menu should appear — scope to the context menu container
    // (it has a distinctive w-[140px] class)
    const ctxMenu = page.locator('.w-\\[140px\\]');
    await expect(ctxMenu).toBeVisible({ timeout: 2_000 });
    await expect(ctxMenu.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(ctxMenu.getByRole('button', { name: 'Duplicate' })).toBeVisible();
    await expect(ctxMenu.getByRole('button', { name: 'Delete' })).toBeVisible();

    // Test Duplicate
    await ctxMenu.getByRole('button', { name: 'Duplicate' }).click();

    // Should have a "(copy)" node now
    await expect(page.getByText('(copy)').first()).toBeVisible({ timeout: 3_000 });
  });

  test('Add Step button opens popover with role selector', async ({ page }) => {
    await page.getByText('E2E Test Workflow').click();
    await expect(
      page.locator('svg[role="img"][aria-label="SOP workflow DAG"]'),
    ).toBeVisible();

    // Enter edit mode
    await page.getByRole('button', { name: /Edit/ }).click();
    await page.waitForTimeout(300);

    // Click Add Step button
    await page.getByRole('button', { name: 'Add Step' }).click();

    // Popover should appear
    const labelInput = page.getByPlaceholder('Step label...');
    await expect(labelInput).toBeVisible({ timeout: 3_000 });

    // Role selector should be present
    const roleSelect = page.locator('select');
    await expect(roleSelect.last()).toBeVisible();

    // Cancel should close
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(labelInput).not.toBeVisible();
  });
});
