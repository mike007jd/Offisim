import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.OFFISIM_VISUAL_BASE_URL ?? 'http://127.0.0.1:4173/';
const companyId = 'c-local-audit';
const timestamp = '2026-04-06T00:41:09.950Z';
const providerConfig = {
  provider: 'openai-compat',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  baseURL: 'https://example.invalid/v1',
};

function createPrefabInstance(instanceId, prefabId, zoneSlug, positionX, positionY) {
  return {
    instance_id: instanceId,
    company_id: companyId,
    prefab_id: prefabId,
    zone_id: `${companyId}::${zoneSlug}`,
    position_x: positionX,
    position_y: positionY,
    rotation: 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createEmployee(employeeId, name, roleSlug, expertise) {
  return {
    employee_id: employeeId,
    company_id: companyId,
    source_asset_id: null,
    source_package_id: null,
    name,
    role_slug: roleSlug,
    workstation_id: null,
    persona_json: JSON.stringify({ expertise }),
    config_json: null,
    enabled: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function createCompany() {
  return {
    company_id: companyId,
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
  };
}

function createSopTemplate() {
  return {
    sop_template_id: 'sop-template-feature-delivery',
    company_id: companyId,
    name: 'Feature Delivery',
    description: 'Ship a feature from brief to QA.',
    definition_json: JSON.stringify(sopDefinition),
    source_thread_id: null,
    source_url: null,
    version: '1',
    last_synced_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
const eventHistory = [
  {
    type: 'employee.state.changed',
    entityId: 'e-mgr-1',
    entityType: 'employee',
    companyId,
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
    companyId,
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
    companyId,
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
const prefabInstances = [
  createPrefabInstance('prefab-workstation-dev-1', 'workstation-standard', 'zone-dev', -13, 11),
  createPrefabInstance('prefab-workstation-design-1', 'workstation-standard', 'zone-art', 12, 11),
  createPrefabInstance('prefab-library-bookshelf-1', 'bookshelf-double', 'zone-library', -12.5, 2),
  createPrefabInstance('prefab-library-bookshelf-2', 'bookshelf-double', 'zone-library', -10, 2),
  createPrefabInstance('prefab-library-table', 'reading-table', 'zone-library', -7.5, 2),
  createPrefabInstance('prefab-rest-sofa', 'sofa-set', 'zone-rest', 8, 2),
  createPrefabInstance('prefab-meeting-table', 'meeting-table-4', 'zone-meeting', -10, -8),
];
const snapshot = {
  companies: [createCompany()],
  employees: [
    createEmployee('e-mgr-1', 'Alex Manager', 'manager', 'project management'),
    createEmployee('e-writer-1', 'Sam Writer', 'writer', 'copywriting'),
    createEmployee('e-dev-1', 'Jamie Dev', 'developer', 'frontend implementation'),
    createEmployee('e-research-1', 'Taylor Research', 'researcher', 'verification'),
    createEmployee('e-design-1', 'Riley Design', 'designer', 'interaction design'),
    createEmployee('e-ops-1', 'Morgan Ops', 'manager', 'runtime operations'),
  ],
  sopTemplates: [createSopTemplate()],
  prefabInstances,
};

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInsideFootprint(point, footprint) {
  return (
    Math.abs(point.x - footprint.cx) < footprint.halfW &&
    Math.abs(point.y - footprint.cz) < footprint.halfD
  );
}

function segmentsIntersect2D(a1, a2, b1, b2) {
  const orientation = (p, q, r) => {
    const value = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(value) < 1e-6) return 0;
    return value > 0 ? 1 : 2;
  };
  const onSegment = (p, q, r) =>
    q.x <= Math.max(p.x, r.x) + 1e-6 &&
    q.x + 1e-6 >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) + 1e-6 &&
    q.y + 1e-6 >= Math.min(p.y, r.y);

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function segmentIntersectsFootprint(start, end, footprint) {
  if (pointInsideFootprint(start, footprint) || pointInsideFootprint(end, footprint)) {
    return true;
  }

  const epsilon = 0.01;
  const left = footprint.cx - footprint.halfW;
  const right = footprint.cx + footprint.halfW;
  const top = footprint.cz - footprint.halfD;
  const bottom = footprint.cz + footprint.halfD;
  const edges = [
    [
      { x: left + epsilon, y: top + epsilon },
      { x: right - epsilon, y: top + epsilon },
    ],
    [
      { x: right - epsilon, y: top + epsilon },
      { x: right - epsilon, y: bottom - epsilon },
    ],
    [
      { x: right - epsilon, y: bottom - epsilon },
      { x: left + epsilon, y: bottom - epsilon },
    ],
    [
      { x: left + epsilon, y: bottom - epsilon },
      { x: left + epsilon, y: top + epsilon },
    ],
  ];

  return edges.some(([a, b]) => segmentsIntersect2D(start, end, a, b));
}

function assertTraceAvoidsFootprints(trace, footprints, label) {
  for (const [sampleIndex, sample] of trace.entries()) {
    for (const [footprintIndex, footprint] of footprints.entries()) {
      assert.equal(
        pointInsideFootprint(sample, footprint),
        false,
        `${label} sample entered footprint at sample ${sampleIndex} (${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) footprint ${footprintIndex} centered at (${footprint.cx.toFixed(2)}, ${footprint.cz.toFixed(2)})`,
      );
    }
  }
  for (let i = 1; i < trace.length; i += 1) {
    const prev = trace[i - 1];
    const current = trace[i];
    if (!prev || !current) continue;
    for (const [footprintIndex, footprint] of footprints.entries()) {
      assert.equal(
        segmentIntersectsFootprint(prev, current, footprint),
        false,
        `${label} segment ${i - 1}->${i} crossed footprint ${footprintIndex} centered at (${footprint.cx.toFixed(2)}, ${footprint.cz.toFixed(2)})`,
      );
    }
  }
}

function logStep(label) {
  console.log(`[visual-check] ${label}`);
}

async function seed(page) {
  await page.goto(baseUrl);
  await page.evaluate(
    ({ providerConfig, snapshot, eventHistory, companyId }) => {
      localStorage.setItem('offisim-provider-config', JSON.stringify(providerConfig));
      localStorage.setItem('offisim:browser-runtime-snapshot:v1', JSON.stringify(snapshot));
      localStorage.setItem('offisim:browser-event-history:v1', JSON.stringify(eventHistory));
      localStorage.setItem('offisim:active-company', companyId);
      localStorage.removeItem('offisim.panel.left');
      localStorage.removeItem('offisim.panel.right');
      localStorage.removeItem('offisim-chat-open');
      localStorage.removeItem('offisim-chat-height');
      localStorage.removeItem('offisim-chat-compact');
    },
    { providerConfig, snapshot, eventHistory, companyId },
  );
  await page.reload();
  await page.waitForSelector('header');
  await page.waitForTimeout(1200);
}

async function waitForDebugBridge(page) {
  await page
    .waitForFunction(
      () =>
        Boolean(
          window.__OFFISIM_DEBUG__?.getSceneState &&
            window.__OFFISIM_DEBUG__?.sceneActions?.moveEmployeeToMeeting &&
            window.__OFFISIM_DEBUG__?.sceneActions?.dispatchEmployeeToWorkspace &&
            window.__OFFISIM_DEBUG__?.sceneActions?.returnEmployeeToMeeting,
        ),
      { timeout: 15000 },
    )
    .catch(() => {
      throw new Error(
        'Offisim visual movement check requires the Vite dev server so window.__OFFISIM_DEBUG__ scene actions are available.',
      );
    });
}

async function getSceneState(page) {
  return page.evaluate(() => window.__OFFISIM_DEBUG__?.getSceneState?.() ?? null);
}

function findZone(state, zoneMatcher) {
  return (
    state?.zones?.find((zone) =>
      zoneMatcher.zoneId
        ? zone.zoneId === zoneMatcher.zoneId
        : zone.archetype === zoneMatcher.archetype,
    ) ?? null
  );
}

function isPointInsideZone(point, zone) {
  return (
    point.x >= zone.cx - zone.w / 2 &&
    point.x <= zone.cx + zone.w / 2 &&
    point.y >= zone.cz - zone.d / 2 &&
    point.y <= zone.cz + zone.d / 2
  );
}

function logIncompleteTrace(label, trace, failureState) {
  const last = trace.samples.at(-1);
  console.log(
    `[visual-check] movement audit: ${label} incomplete samples=${trace.samples.length} last=${last ? `(${last.x.toFixed(2)}, ${last.y.toFixed(2)}) moving=${last.isMoving}` : 'none'}`,
  );
  console.log(
    `[visual-check] movement audit: ${label} incomplete route=${JSON.stringify(failureState?.lastRoute ?? null)}`,
  );
}

async function assertMovementTraceCompleted(page, trace, label, message) {
  if (!trace.completed) {
    const failureState = await getSceneState(page);
    logIncompleteTrace(label, trace, failureState);
  }
  assert.equal(trace.completed, true, message);
}

function assertMovementTraceShape(trace, label) {
  const first = trace.samples[0];
  const last = trace.samples.at(-1);
  assert.ok(first && last, `${label} trace should include first and last samples`);
  assert.ok(trace.samples.length > 5, `${label} trace should capture the route`);
  assert.ok(distance2D(first, last) > 3, `${label} trace should cover a meaningful distance`);
  assert.ok(
    trace.obstacleFootprints.some((footprint) =>
      segmentIntersectsFootprint(first, last, footprint),
    ),
    `seeded scene should place at least one obstacle on the direct ${label} line`,
  );
  return { first, last };
}

async function invokeSceneAction(page, actionName, employeeId) {
  return page.evaluate(
    ({ actionName, employeeId }) =>
      window.__OFFISIM_DEBUG__?.sceneActions?.[actionName]?.(employeeId) ?? false,
    { actionName, employeeId },
  );
}

async function assertTraceWithRouteDump(page, trace, footprints, label) {
  try {
    assertTraceAvoidsFootprints(trace, footprints, label);
  } catch (error) {
    const failureState = await getSceneState(page);
    console.log(
      `[visual-check] movement audit: ${label} route=${JSON.stringify(failureState?.lastRoute ?? null)}`,
    );
    throw error;
  }
}

async function sampleEmployeeTrace(
  page,
  employeeId,
  { timeoutMs = 15000, targetZoneId = null, targetArchetype = null } = {},
) {
  return page.evaluate(
    async ({ employeeId, timeoutMs, targetZoneId, targetArchetype }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const samples = [];
      let sawMotion = false;
      let lastMovingAt = 0;
      const startedAt = performance.now();

      while (performance.now() - startedAt < timeoutMs) {
        const state = window.__OFFISIM_DEBUG__?.getSceneState?.();
        const employee = state?.employeeDebugInfo?.find((entry) => entry.id === employeeId);
        const targetZone =
          state?.zones?.find((zone) =>
            targetZoneId
              ? zone.zoneId === targetZoneId
              : targetArchetype
                ? zone.archetype === targetArchetype
                : false,
          ) ?? null;
        if (employee) {
          samples.push({
            x: employee.x,
            y: employee.y,
            isMoving: Boolean(employee.isMoving),
            t: performance.now() - startedAt,
          });
          if (employee.isMoving) {
            sawMotion = true;
            lastMovingAt = performance.now();
          }
          const insideTargetZone = targetZone
            ? employee.x >= targetZone.cx - targetZone.w / 2 &&
              employee.x <= targetZone.cx + targetZone.w / 2 &&
              employee.y >= targetZone.cz - targetZone.d / 2 &&
              employee.y <= targetZone.cz + targetZone.d / 2
            : true;
          if (
            sawMotion &&
            insideTargetZone &&
            !employee.isMoving &&
            performance.now() - lastMovingAt > 350
          ) {
            return {
              completed: true,
              samples,
              obstacleFootprints: state?.obstacleFootprints ?? [],
              zones: state?.zones ?? [],
            };
          }
        }
        await sleep(50);
      }

      const state = window.__OFFISIM_DEBUG__?.getSceneState?.();
      return {
        completed: false,
        samples,
        obstacleFootprints: state?.obstacleFootprints ?? [],
        zones: state?.zones ?? [],
      };
    },
    { employeeId, timeoutMs, targetZoneId, targetArchetype },
  );
}

async function runMovementAudit(page) {
  logStep('movement audit: waiting for debug bridge');
  await waitForDebugBridge(page);
  await page.waitForFunction(
    () => {
      const state = window.__OFFISIM_DEBUG__?.getSceneState?.();
      return Boolean(state?.employeeDebugInfo?.length && state?.obstacleFootprints?.length);
    },
    { timeout: 15000 },
  );

  const initialState = await getSceneState(page);
  assert.ok(
    (initialState?.obstacleFootprints?.length ?? 0) > 0,
    'scene should expose obstacle footprints',
  );

  const employeeId = 'e-dev-1';
  const employeeZoneId = `${companyId}::zone-dev`;
  const isEmployeeInsideZone = (state, zoneMatcher) => {
    const employee = state?.employeeDebugInfo?.find((entry) => entry.id === employeeId);
    const zone = findZone(state, zoneMatcher);
    if (!employee || !zone) return false;
    return isPointInsideZone(employee, zone);
  };

  logStep('movement audit: gathering employee to meeting');
  assert.equal(await invokeSceneAction(page, 'moveEmployeeToMeeting', employeeId), true);
  await page.waitForTimeout(6000);
  assert.equal(
    isEmployeeInsideZone(await getSceneState(page), { archetype: 'meeting' }),
    true,
    'employee should start the dispatch route from the meeting zone',
  );

  logStep('movement audit: dispatching employee');
  assert.equal(await invokeSceneAction(page, 'dispatchEmployeeToWorkspace', employeeId), true);
  const dispatchTrace = await sampleEmployeeTrace(page, employeeId, {
    timeoutMs: 30000,
    targetZoneId: employeeZoneId,
  });
  await assertMovementTraceCompleted(
    page,
    dispatchTrace,
    'dispatch',
    'employee should finish the dispatch route into the workspace zone',
  );
  const { last: dispatchLast } = assertMovementTraceShape(dispatchTrace, 'dispatch');
  console.log(
    `[visual-check] movement audit: dispatch final=${JSON.stringify(dispatchLast)} route=${JSON.stringify((await getSceneState(page))?.lastRoute ?? null)}`,
  );
  await assertTraceWithRouteDump(
    page,
    dispatchTrace.samples,
    dispatchTrace.obstacleFootprints,
    'dispatch',
  );

  logStep('movement audit: returning employee for approval');
  assert.equal(await invokeSceneAction(page, 'returnEmployeeToMeeting', employeeId), true);
  const returnTrace = await sampleEmployeeTrace(page, employeeId, {
    timeoutMs: 30000,
    targetArchetype: 'meeting',
  });
  await assertMovementTraceCompleted(
    page,
    returnTrace,
    'return',
    'employee should finish the approval return route into the meeting zone',
  );
  assertMovementTraceShape(returnTrace, 'return');
  await assertTraceWithRouteDump(
    page,
    returnTrace.samples,
    returnTrace.obstacleFootprints,
    'approval return',
  );
}

async function runDesktopAudit(page) {
  logStep('desktop: seeded');
  await waitForDebugBridge(page);
  assert.ok(await page.getByRole('button', { name: 'Collapse personnel panel' }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Collapse operations panel' }).isVisible());
  assert.ok(await page.getByRole('tab', { name: 'SOPs' }).isVisible());
  assert.equal(await page.getByTitle('Layout Editor').count(), 0);
  assert.ok(await page.getByTitle('Decoration Studio').isVisible());

  const zoneLabelBoxes = await page.locator('[data-zone-label]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.getAttribute('data-zone-label'),
        centerX: rect.x + rect.width / 2,
      };
    }),
  );
  for (const box of zoneLabelBoxes) {
    assert.ok(
      box.centerX >= 280 && box.centerX <= 1440 - 280,
      `Zone label ${box.label} should stay inside the visible scene gutter`,
    );
  }

  await page.getByRole('tab', { name: 'SOPs' }).click();
  logStep('desktop: opened SOP tab');
  await page
    .getByRole('button', { name: /Feature Delivery/ })
    .first()
    .click();
  logStep('desktop: opened SOP item');
  await page.waitForSelector('text=Batch 5');
  const drawerBox = await page.locator('.fixed.inset-y-4.right-4').first().boundingBox();
  assert.ok(
    drawerBox && drawerBox.width >= 780,
    'SOP drawer should be wide enough for the full timeline',
  );
  assert.ok(
    await page.getByText('Batch 5').isVisible(),
    'Later SOP batches should be visible without hidden truncation',
  );

  await page.locator('button[aria-label^="Notifications"]').click();
  logStep('desktop: opened notifications');
  await page.waitForSelector('text=Notifications');
  await page.mouse.click(40, 140);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('text=Notifications').count(), 0);

  const chatInput = page.getByPlaceholder('Message your team...');
  const inputBox = await chatInput.boundingBox();
  assert.ok(inputBox, 'chat input should have a bounding box');
  assert.ok(inputBox.y + inputBox.height <= 900, 'chat input should remain inside the viewport');
  await page.screenshot({ path: 'output/playwright/ui-regression-desktop.png', fullPage: false });

  await page.locator('button[aria-label="Settings"]').click();
  logStep('desktop: opened settings');
  await page.waitForSelector('text=Settings');
  await page.locator('#settings-api-key').fill('sk-test');
  await page.mouse.click(20, 20);
  await page.waitForTimeout(250);
  assert.ok(
    await page.locator('text=Settings').isVisible(),
    'Settings should stay open on outside click',
  );
  await page.getByRole('tab', { name: 'Runtime Policy' }).click();
  assert.ok(await page.getByText('Default Model Profile').isVisible());
  assert.ok(await page.getByRole('button', { name: 'Save Runtime Policy' }).isVisible());
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Events' }).click();
  logStep('desktop: opened events');
  assert.ok(
    await page
      .getByText(
        'Provider retry queue exceeded the current budget, so execution paused until the next approval window opens.',
      )
      .isVisible(),
  );
  await page.screenshot({ path: 'output/playwright/ui-regression-events.png', fullPage: false });

  await page.getByText('Alex Manager').first().click();
  logStep('desktop: opened employee inspector');
  await page.waitForSelector('[data-testid="employee-inspector"]');
  assert.ok(await page.getByText('Available for the next assignment.').isVisible());
  assert.ok(await page.getByRole('button', { name: 'Edit Profile' }).isVisible());
  await page.screenshot({ path: 'output/playwright/ui-regression-inspector.png', fullPage: false });

  await runMovementAudit(page);
  logStep('desktop: movement audit passed');
}

async function runTabletAudit(page) {
  logStep('tablet: seeding');
  await seed(page);
  await waitForDebugBridge(page);
  assert.ok(await page.getByRole('button', { name: 'Collapse personnel panel' }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Expand operations panel' }).isVisible());
  await page.screenshot({ path: 'output/playwright/ui-regression-tablet.png', fullPage: false });
}

const browser = await chromium.launch({ headless: true });

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
logStep('desktop: seeding');
await seed(desktop);
await runDesktopAudit(desktop);

const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await runTabletAudit(tablet);

await browser.close();
console.log('visual-check:ok');
