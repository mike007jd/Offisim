/**
 * Offisim fork of pi-ai `providers/register-builtins.ts`.
 *
 * The upstream module lazily registers nine provider families (Anthropic,
 * OpenAI completions/responses/codex, Azure, Google, Google Vertex, Mistral,
 * Bedrock). The lazy `import()` chunks still force the bundler to resolve
 * AWS/Smithy/Google/Mistral SDKs, which are Node-only and break the Tauri
 * WebView bundle. This fork physically registers only the two lanes Offisim
 * ships — `anthropic-messages` (z.ai Coding Plan / Claude-compatible) and
 * `openai-completions` (MiniMax / OpenAI-compatible) — with direct imports.
 */

import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import { streamAnthropic, streamSimpleAnthropic } from "./anthropic.js";
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from "./openai-completions.js";

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});

	registerApiProvider({
		api: "openai-completions",
		stream: streamOpenAICompletions,
		streamSimple: streamSimpleOpenAICompletions,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
