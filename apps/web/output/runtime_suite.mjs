import { chromium } from '@playwright/test';

const baseUrl = process.env.OFFISIM_URL ?? 'http://localhost:5179/';
const defaultProvider = {
  provider: process.env.OFFISIM_PROVIDER ?? 'anthropic',
  apiKey: process.env.OFFISIM_API_KEY ?? '',
  baseURL: process.env.OFFISIM_BASE_URL ?? 'https://api.minimax.io/anthropic',
  model: process.env.OFFISIM_MODEL ?? 'MiniMax-M2.7-highspeed',
};

function nowIso() {
  return new Date().toISOString();
}

function makeSeedSnapshot(providerConfig, companyId) {
  const now = nowIso();
  return {
    companies: [
      {
        company_id: companyId,
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
        company_id: companyId,
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
        company_id: companyId,
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
      {
        employee_id: 'e-design-1',
        company_id: companyId,
        source_asset_id: null,
        source_package_id: null,
        name: 'Design Bot',
        role_slug: 'ux_designer',
        workstation_id: null,
        persona_json: JSON.stringify({ expertise: 'UI/UX design' }),
        config_json: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

async function bootPage(browser, scenarioName, providerOverride = {}) {
  const page = await browser.newPage();
  const companyId = `c-${scenarioName}`;
  const provider = { ...defaultProvider, ...providerOverride };
  const snapshot = makeSeedSnapshot(provider, companyId);

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('Failed') || text.includes('Error')) {
      console.error(`[browser:${scenarioName}:${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    console.error(`[browser:${scenarioName}:pageerror] ${error.message}`);
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ providerConfig, seededSnapshot, companyId: activeCompanyId }) => {
    localStorage.setItem('offisim-provider-config', JSON.stringify(providerConfig));
    localStorage.setItem('offisim:browser-runtime-snapshot:v1', JSON.stringify(seededSnapshot));
    localStorage.setItem('offisim:active-company', activeCompanyId);
    localStorage.removeItem('offisim:browser-event-history:v1');
  }, { providerConfig: provider, seededSnapshot: snapshot, companyId });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__OFFISIM_DEBUG__ !== 'undefined', {
    timeout: 15000,
  });
  await page.getByPlaceholder('Message your team...').waitFor({ state: 'visible', timeout: 15000 });
  return page;
}

async function sendTeamMessage(page, message) {
  const input = page.getByPlaceholder('Message your team...');
  await input.fill(message);
  await input.locator('..').locator('button').click();
}

async function sendCurrentInput(page, message) {
  const input = page.locator('textarea').last();
  await input.fill(message);
  await input.locator('..').locator('button').click();
}

async function waitForAssistantCount(page, count, timeout = 60000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-role="assistant"]').length >= expected,
    count,
    { timeout },
  );
}

async function assistantTexts(page) {
  return page.locator('[data-role="assistant"]').allTextContents();
}

async function snapshot(page) {
  return page.evaluate(() => {
    const snapRaw = localStorage.getItem('offisim:browser-runtime-snapshot:v1');
    const eventsRaw = localStorage.getItem('offisim:browser-event-history:v1');
    return {
      snapshot: snapRaw ? JSON.parse(snapRaw) : null,
      events: eventsRaw ? JSON.parse(eventsRaw) : [],
    };
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scenarioBasic(browser) {
  const page = await bootPage(browser, 'basic');
  try {
    await sendTeamMessage(page, 'Reply with exactly OFFISIM_BASIC_OK and nothing else.');
    await waitForAssistantCount(page, 1);
    const state = await snapshot(page);
    const texts = await assistantTexts(page);
    return {
      assistant: texts.at(-1) ?? '',
      llmCalls: state.snapshot?.llmCalls?.length ?? 0,
      threads: state.snapshot?.threads?.length ?? 0,
      graphEvents: state.events.map((e) => e.type),
      toolCalls: state.snapshot?.toolCalls?.length ?? 0,
      mcpAudit: state.snapshot?.mcpAudit?.length ?? 0,
    };
  } finally {
    await page.close();
  }
}

async function scenarioMemory(browser) {
  const page = await bootPage(browser, 'memory');
  try {
    await sendTeamMessage(page, 'Remember this user fact: my favorite color is orange.');
    await waitForAssistantCount(page, 1);

    let preferenceCount = 0;
    for (let i = 0; i < 10; i += 1) {
      const state = await snapshot(page);
      preferenceCount = state.snapshot?.userPreferences?.length ?? 0;
      if (preferenceCount > 0) break;
      await sleep(1000);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__OFFISIM_DEBUG__ !== 'undefined', {
      timeout: 15000,
    });
    await sendTeamMessage(page, 'What is my favorite color? Answer in four words max.');
    await waitForAssistantCount(page, 1);
    const state = await snapshot(page);
    const texts = await assistantTexts(page);
    return {
      preferenceCount: state.snapshot?.userPreferences?.length ?? 0,
      answer: texts.at(-1) ?? '',
    };
  } finally {
    await page.close();
  }
}

async function scenarioDelegation(browser) {
  const page = await bootPage(browser, 'delegation');
  try {
    await sendTeamMessage(
      page,
      'Have your manager delegate a TypeScript debugging task to Dev Bot, then report back in two bullets.',
    );
    await waitForAssistantCount(page, 1);
    const state = await snapshot(page);
    return {
      assistant: (await assistantTexts(page)).at(-1) ?? '',
      handoffs: state.snapshot?.handoffs?.length ?? 0,
      taskRuns: state.snapshot?.taskRuns?.length ?? 0,
      agentEvents: (state.snapshot?.agentEvents ?? []).slice(-10),
    };
  } finally {
    await page.close();
  }
}

async function scenarioDirectChat(browser) {
  const page = await bootPage(browser, 'direct');
  try {
    const input = page.getByPlaceholder('Message your team...');
    await input.fill('@Dev');
    await page.getByText('Dev Bot').click();
    const directInput = page.getByPlaceholder('Message Dev Bot...');
    await directInput.fill('Reply with exactly DEV_DIRECT_OK.');
    await directInput.locator('..').locator('button').click();
    await waitForAssistantCount(page, 1);
    const state = await snapshot(page);
    return {
      assistant: (await assistantTexts(page)).at(-1) ?? '',
      threads: state.snapshot?.threads ?? [],
      handoffs: state.snapshot?.handoffs?.length ?? 0,
    };
  } finally {
    await page.close();
  }
}

async function scenarioMeeting(browser) {
  const page = await bootPage(browser, 'meeting');
  try {
    await sendTeamMessage(page, '/meeting standup about runtime regressions');
    await page.getByTitle('Pause meeting').waitFor({ state: 'visible', timeout: 60000 });
    await page.getByTitle('Pause meeting').click();
    await page.getByTitle('Resume meeting').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTitle('Resume meeting').click();
    await page.getByTitle('End meeting').click();
    await page.waitForFunction(() => {
      const snapRaw = localStorage.getItem('offisim:browser-runtime-snapshot:v1');
      const eventsRaw = localStorage.getItem('offisim:browser-event-history:v1');
      const snapshot = snapRaw ? JSON.parse(snapRaw) : null;
      const events = eventsRaw ? JSON.parse(eventsRaw) : [];
      const meetings = snapshot?.meetings ?? [];
      const latestMeeting = meetings.at(-1);
      const completedEvent = events.some(
        (event) =>
          String(event.type) === 'meeting.state.changed' &&
          (event.payload?.next === 'completed' || event.payload?.next === 'cancelled'),
      );
      return (
        completedEvent ||
        latestMeeting?.status === 'completed' ||
        latestMeeting?.status === 'cancelled'
      );
    }, { timeout: 30000 });
    const state = await snapshot(page);
    return {
      meetings: state.snapshot?.meetings ?? [],
      meetingEvents: state.events.filter((event) => String(event.type).startsWith('meeting.')),
    };
  } finally {
    await page.close();
  }
}

async function scenarioAbort(browser) {
  const page = await bootPage(browser, 'abort');
  try {
    await sendTeamMessage(
      page,
      'Write a very detailed thirty-step implementation roadmap with rationale for each step.',
    );
    await page.getByTitle('Stop execution').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTitle('Stop execution').click();
    await sleep(1500);
    const state = await snapshot(page);
    return {
      threads: state.snapshot?.threads ?? [],
      taskRuns: state.snapshot?.taskRuns ?? [],
      agentEvents: (state.snapshot?.agentEvents ?? []).slice(-10),
    };
  } finally {
    await page.close();
  }
}

async function scenarioBadProvider(browser) {
  const page = await bootPage(browser, 'bad-provider', {
    baseURL: 'http://127.0.0.1:9/anthropic',
  });
  try {
    await sendTeamMessage(page, 'Reply with BAD_PROVIDER_OK.');
    await page.getByText(/Request failed|fetch failed|ECONNREFUSED|Error/i).first().waitFor({
      state: 'visible',
      timeout: 30000,
    });
    return {
      errorText: await page.locator('text=/Request failed|fetch failed|ECONNREFUSED|Error/i').first().textContent(),
      inputStillVisible: await page.getByPlaceholder('Message your team...').isVisible(),
    };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });

try {
  const scenarios = {
    basic: scenarioBasic,
    memory: scenarioMemory,
    delegation: scenarioDelegation,
    directChat: scenarioDirectChat,
    meeting: scenarioMeeting,
    abort: scenarioAbort,
    badProvider: scenarioBadProvider,
  };

  const results = {};
  const selectedNames = process.env.OFFISIM_SCENARIO
    ? process.env.OFFISIM_SCENARIO.split(',').map((name) => name.trim()).filter(Boolean)
    : Object.keys(scenarios);

  for (const name of selectedNames) {
    const fn = scenarios[name];
    if (!fn) {
      results[name] = { error: `Unknown scenario: ${name}` };
      continue;
    }
    try {
      results[name] = await fn(browser);
    } catch (error) {
      results[name] = {
        error: error instanceof Error ? error.message : String(error),
        name: error?.name,
      };
    }
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
