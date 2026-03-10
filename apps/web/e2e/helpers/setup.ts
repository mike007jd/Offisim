import { type Page, expect } from '@playwright/test';

const STORAGE_KEY = 'aics-provider-config';

export interface TestProviderConfig {
  provider: 'openai-compat';
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Inject an OpenRouter provider config into localStorage and reload.
 * Uses OPENROUTER_API_KEY from process.env (loaded from .env.local via playwright.config.ts).
 */
export async function injectProvider(page: Page): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY not found in environment. ' +
        'Make sure .env.local exists at repo root with OPENROUTER_API_KEY=...',
    );
  }

  // Model from env (OPENROUTER_MODEL in .env.local) or fallback.
  // google/gemma-3-4b-it:free does NOT support system messages via Google AI Studio,
  // so we default to Llama 3.3 which reliably supports them.
  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

  const config: TestProviderConfig = {
    provider: 'openai-compat',
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    model,
  };

  await page.goto('/');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: STORAGE_KEY,
    value: JSON.stringify(config),
  });
  await page.reload();
}

/**
 * Wait for the AICS runtime to be ready (debug bridge available on window).
 */
export async function waitForRuntime(page: Page): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: window debug bridge access in E2E
  await page.waitForFunction(() => (window as any).__AICS_DEBUG__ !== undefined, {
    timeout: 15_000,
  });
}

/**
 * Open the chat drawer (it starts collapsed) and wait for input to be ready.
 * The toggle button contains text "Show Chat" / "Hide Chat".
 */
export async function openChat(page: Page): Promise<void> {
  // ChatDrawer toggle button has a <span>Show Chat</span> inside
  const showChatBtn = page.getByText('Show Chat');
  // Only click if chat is currently hidden
  if (await showChatBtn.isVisible()) {
    await showChatBtn.click();
  }
  await expect(page.getByPlaceholder('Send a message...')).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Type a message and send it via the chat input.
 * Locates the send button within the chat input container (flex row with textarea + button).
 */
export async function sendChat(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder('Send a message...');
  await input.fill(message);
  // The send button is the sibling Button of the textarea, inside the same
  // .flex.items-end.gap-2 container. Use the parent container to scope.
  const chatInputContainer = input.locator('..');
  const sendBtn = chatInputContainer.locator('button');
  await sendBtn.click();
}

/**
 * Wait for an AI response to appear in the chat panel.
 * Returns the text content of the last assistant message.
 */
export async function waitForResponse(page: Page, timeout = 45_000): Promise<string> {
  // First wait for at least one assistant bubble to exist in the DOM
  await page.locator('[data-role="assistant"]').first().waitFor({
    state: 'visible',
    timeout,
  });
  // Then grab the last one (in case multiple responses)
  const responseBubble = page.locator('[data-role="assistant"]').last();
  const text = await responseBubble.textContent();
  return text ?? '';
}
