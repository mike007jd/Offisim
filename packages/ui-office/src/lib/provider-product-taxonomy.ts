import type {
  LlmExecutionLane,
  LlmProvider,
  ProviderAuthStrategy,
  ProviderCatalogSource,
  ProviderProductAccessMode,
  ProviderProductId,
  ResolvedProviderVariant,
} from '@offisim/shared-types';
import curatedCatalog from '../../../../catalog/provider-source-registry/generated/curated-catalog.json' with {
  type: 'json',
};

export type ProviderVendor =
  | 'offisim'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'zai'
  | 'lmstudio'
  | 'custom'
  | 'qwen';

export type ProviderRegion = 'intl' | 'cn' | 'shared' | 'local';

export type ProviderCompatibility = 'native' | 'anthropic-compatible' | 'openai-compatible';

export type ProviderSurface = 'general' | 'coding-plan';

export interface ProviderCapabilities {
  streaming: boolean;
  thinking: boolean;
  toolCalls: boolean;
  toolStreaming: boolean;
  codingPlan: boolean;
}

export interface ProviderVariantDefinition extends ResolvedProviderVariant {
  readonly vendor: ProviderVendor;
  readonly compatibility?: ProviderCompatibility;
  readonly region?: ProviderRegion;
  readonly surface?: ProviderSurface;
  readonly productName: string;
  readonly authMode: ProviderProductAccessMode;
  readonly capabilities: ProviderCapabilities;
  readonly communityDisplayName?: string;
  readonly communityDocsUrl?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly modelDisplayNames: Readonly<Record<string, string>>;
  readonly notes?: string;
}

export interface ProviderProductAccessDefinition {
  readonly accessMode: ProviderProductAccessMode;
  readonly label: string;
  readonly description: string;
  readonly authStrategy: ProviderAuthStrategy;
  readonly defaultVariantId?: string;
  readonly variantIds?: ReadonlyArray<string>;
  readonly supportedExecutionLanes?: ReadonlyArray<LlmExecutionLane>;
  readonly endpointOverrideMode: 'hidden' | 'optional' | 'required';
  readonly defaultApiKeyValue?: string;
}

export interface ProviderProductDefinition {
  readonly productId: ProviderProductId;
  readonly displayName: string;
  readonly family: string;
  readonly description: string;
  readonly catalogSource: ProviderCatalogSource;
  readonly defaultAccessMode: ProviderProductAccessMode;
  readonly accessModes: ReadonlyArray<ProviderProductAccessDefinition>;
  readonly variantIds: ReadonlyArray<string>;
  readonly advancedRoutingDescription: string;
  readonly metadataOwnership: string;
}

interface CuratedCatalogModelEntry {
  readonly displayName?: string;
}

interface CuratedCatalogProviderEntry {
  readonly authMode?: string;
  readonly baseURL?: string | null;
  readonly communityDisplayName?: string;
  readonly communityDocsUrl?: string;
  readonly compatibility: ProviderCompatibility;
  readonly defaultModel?: string;
  readonly executionLaneHints?: {
    readonly productExposed?: ReadonlyArray<LlmExecutionLane>;
  };
  readonly models?: Readonly<Record<string, CuratedCatalogModelEntry>>;
  readonly notes?: string;
  readonly productName: string;
  readonly providerTransport: LlmProvider;
  readonly region: ProviderRegion;
  readonly supportedEndpoints?: ReadonlyArray<string>;
  readonly surface: ProviderSurface;
  readonly vendor: ProviderVendor;
}

interface CuratedCatalogShape {
  readonly providers: Readonly<Record<string, CuratedCatalogProviderEntry>>;
}

const DEFAULT_EXECUTION_LANE: LlmExecutionLane = 'gateway';

const PROVIDER_VENDORS = new Set<ProviderVendor>([
  'offisim',
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'deepseek',
  'minimax',
  'kimi',
  'zai',
  'lmstudio',
  'custom',
  'qwen',
]);
const PROVIDER_REGIONS = new Set<ProviderRegion>(['intl', 'cn', 'shared', 'local']);
const PROVIDER_COMPATIBILITIES = new Set<ProviderCompatibility>([
  'native',
  'anthropic-compatible',
  'openai-compatible',
]);
const PROVIDER_SURFACES = new Set<ProviderSurface>(['general', 'coding-plan']);

const CURATED_VARIANT_PRODUCT_IDS: Record<string, ProviderProductId> = {
  'anthropic-default': 'anthropic-api',
  custom: 'custom-compatible',
  'deepseek-openai-general': 'deepseek',
  'gemini-openai-general': 'gemini',
  'kimi-cn-anthropic-coding': 'kimi',
  'kimi-cn-openai-general': 'kimi',
  'kimi-intl-openai-general': 'kimi',
  lmstudio: 'lmstudio',
  'minimax-cn-anthropic-coding': 'minimax',
  'minimax-intl-anthropic-coding': 'minimax',
  'openai-default': 'openai-api',
  'openrouter-openai-general': 'openrouter',
  'zai-shared-anthropic-coding': 'zai-glm',
  'zai-shared-openai-coding': 'zai-glm',
  'zai-shared-openai-general': 'zai-glm',
};

const CURATED_VARIANT_CAPABILITIES: Partial<Record<string, ProviderCapabilities>> = {
  'anthropic-default': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
  'deepseek-openai-general': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
  'gemini-openai-general': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
  'kimi-cn-anthropic-coding': createCapabilities({
    thinking: true,
    toolCalls: true,
    codingPlan: true,
  }),
  'kimi-cn-openai-general': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
  'kimi-intl-openai-general': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
  lmstudio: createCapabilities({}),
  'minimax-cn-anthropic-coding': createCapabilities({
    thinking: true,
    toolCalls: true,
    codingPlan: true,
  }),
  'minimax-intl-anthropic-coding': createCapabilities({
    thinking: true,
    toolCalls: true,
    codingPlan: true,
  }),
  'openai-default': createCapabilities({
    toolCalls: true,
  }),
  'openrouter-openai-general': createCapabilities({
    toolCalls: true,
  }),
  'zai-shared-anthropic-coding': createCapabilities({
    thinking: true,
    toolCalls: true,
    codingPlan: true,
  }),
  'zai-shared-openai-coding': createCapabilities({
    thinking: true,
    toolCalls: true,
    codingPlan: true,
  }),
  'zai-shared-openai-general': createCapabilities({
    thinking: true,
    toolCalls: true,
  }),
};

const CURATED_VARIANT_LANES: Partial<Record<string, ReadonlyArray<LlmExecutionLane>>> = {
  'anthropic-default': ['gateway'],
  custom: ['gateway'],
  'deepseek-openai-general': ['gateway'],
  'gemini-openai-general': ['gateway'],
  'kimi-cn-anthropic-coding': ['gateway'],
  'kimi-cn-openai-general': ['gateway'],
  'kimi-intl-openai-general': ['gateway'],
  lmstudio: ['gateway'],
  'minimax-cn-anthropic-coding': ['gateway'],
  'minimax-intl-anthropic-coding': ['gateway', 'claude-agent-sdk'],
  'openai-default': ['gateway', 'openai-agents-sdk'],
  'openrouter-openai-general': ['gateway'],
  'zai-shared-anthropic-coding': ['gateway', 'claude-agent-sdk'],
  'zai-shared-openai-coding': ['gateway'],
  'zai-shared-openai-general': ['gateway'],
};

const LOCAL_VARIANTS: Record<string, ProviderVariantDefinition> = {
  'claude-local-auth': {
    productId: 'claude',
    providerVariantId: 'claude-local-auth',
    provider: 'anthropic',
    displayName: 'Claude',
    productName: 'Claude',
    catalogSource: 'repo-owned',
    vendor: 'anthropic',
    compatibility: 'native',
    region: 'shared',
    surface: 'coding-plan',
    defaultModel: 'claude-sonnet-4-20250514',
    supportedExecutionLanes: ['claude-agent-sdk'],
    modelIds: ['claude-sonnet-4-20250514'],
    authMode: 'subscription',
    capabilities: createCapabilities({
      thinking: true,
      codingPlan: true,
    }),
    modelDisplayNames: {
      'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    },
    notes:
      'Repo-owned local-auth product. Desktop trusted host resolves local Claude auth without exposing credential bytes to TypeScript. This is SDK-backed model transport, not a tool-capable runtime; use gateway or a verified runtime profile for Offisim tools.',
  },
  'codex-local-auth': {
    productId: 'codex',
    providerVariantId: 'codex-local-auth',
    provider: 'openai',
    displayName: 'Codex',
    productName: 'Codex',
    catalogSource: 'repo-owned',
    vendor: 'openai',
    compatibility: 'native',
    region: 'shared',
    surface: 'coding-plan',
    defaultModel: 'gpt-5.4',
    supportedExecutionLanes: ['codex-agent-sdk'],
    modelIds: ['gpt-5.4'],
    authMode: 'local-auth',
    capabilities: createCapabilities({
      thinking: true,
      codingPlan: true,
    }),
    modelDisplayNames: {
      'gpt-5.4': 'GPT-5.4',
    },
    notes:
      'Repo-owned local-auth product. Codex is host-gated and fails closed until a trusted local-auth resolver is available. This is SDK-backed model transport, not a tool-capable runtime; use gateway or a verified runtime profile for Offisim tools.',
  },
  'qwen-model-studio-manual': {
    productId: 'qwen-model-studio',
    providerVariantId: 'qwen-model-studio-manual',
    provider: 'openai-compat',
    displayName: 'Qwen / Model Studio',
    productName: 'Qwen / Model Studio',
    catalogSource: 'repo-owned',
    vendor: 'qwen',
    compatibility: 'openai-compatible',
    region: 'shared',
    surface: 'general',
    defaultModel: '',
    supportedExecutionLanes: ['gateway'],
    modelIds: [],
    authMode: 'api-key',
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
    modelDisplayNames: {},
    notes:
      'Repo-owned product placeholder until provider-source-registry adds reviewed Qwen / Model Studio coverage. Manual endpoint override is required.',
  },
};

export const PROVIDER_VARIANTS: Readonly<Record<string, ProviderVariantDefinition>> = {
  ...buildCuratedProviderVariants(),
  ...LOCAL_VARIANTS,
};

const PRODUCT_ORDER: readonly ProviderProductId[] = [
  'codex',
  'openai-api',
  'claude',
  'anthropic-api',
  'openrouter',
  'kimi',
  'qwen-model-studio',
  'minimax',
  'zai-glm',
  'custom-compatible',
  'gemini',
  'deepseek',
  'lmstudio',
];

export const PROVIDER_PRODUCTS: Readonly<Record<ProviderProductId, ProviderProductDefinition>> = {
  codex: {
    productId: 'codex',
    displayName: 'Codex',
    family: 'Local auth',
    description: 'Host-gated Codex / ChatGPT local-auth product.',
    catalogSource: 'repo-owned',
    defaultAccessMode: 'local-auth',
    accessModes: [
      {
        accessMode: 'local-auth',
        label: 'Local auth',
        description: 'Use trusted local auth on a verified desktop host.',
        authStrategy: 'trusted-local-auth',
        defaultVariantId: 'codex-local-auth',
        variantIds: ['codex-local-auth'],
        supportedExecutionLanes: ['codex-agent-sdk'],
        endpointOverrideMode: 'hidden',
      },
    ],
    variantIds: ['codex-local-auth'],
    advancedRoutingDescription:
      'Codex is host-gated. Runtime binding is created only when a trusted local-auth resolver is available.',
    metadataOwnership:
      'Repo-owned product metadata only. There is no curated source-registry variant for Codex local auth.',
  },
  'openai-api': {
    productId: 'openai-api',
    displayName: 'OpenAI API',
    family: 'Native API',
    description: 'Native OpenAI API backed by the curated provider catalog.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use a standard OpenAI API key.',
        authStrategy: 'api-key',
        defaultVariantId: 'openai-default',
        variantIds: ['openai-default'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['openai-default'],
    advancedRoutingDescription:
      'Native OpenAI defaults come from the curated catalog; endpoint and lane are advanced overrides.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only supplies the user-facing product label.',
  },
  claude: {
    productId: 'claude',
    displayName: 'Claude',
    family: 'Subscription',
    description: 'Host-gated Claude local subscription/auth product.',
    catalogSource: 'repo-owned',
    defaultAccessMode: 'subscription',
    accessModes: [
      {
        accessMode: 'subscription',
        label: 'Subscription',
        description: 'Use trusted local Claude auth on desktop.',
        authStrategy: 'trusted-local-auth',
        defaultVariantId: 'claude-local-auth',
        variantIds: ['claude-local-auth'],
        supportedExecutionLanes: ['claude-agent-sdk'],
        endpointOverrideMode: 'hidden',
      },
    ],
    variantIds: ['claude-local-auth'],
    advancedRoutingDescription:
      'Claude subscription auth is host-gated. The trusted host resolves availability separately from API-key products.',
    metadataOwnership:
      'Repo-owned product metadata only. There is no public curated variant for Claude subscription auth.',
  },
  'anthropic-api': {
    productId: 'anthropic-api',
    displayName: 'Anthropic API',
    family: 'Native API',
    description: 'Native Anthropic API backed by the curated provider catalog.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use a standard Anthropic API key.',
        authStrategy: 'api-key',
        defaultVariantId: 'anthropic-default',
        variantIds: ['anthropic-default'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['anthropic-default'],
    advancedRoutingDescription:
      'Anthropic API defaults come from the curated catalog; endpoint and lane remain advanced overrides.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only owns the product grouping.',
  },
  openrouter: {
    productId: 'openrouter',
    displayName: 'OpenRouter',
    family: 'OpenAI-compatible API',
    description: 'Curated OpenRouter routing through the OpenAI-compatible transport.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use an OpenRouter API key through the curated default endpoint.',
        authStrategy: 'api-key',
        defaultVariantId: 'openrouter-openai-general',
        variantIds: ['openrouter-openai-general'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['openrouter-openai-general'],
    advancedRoutingDescription:
      'OpenRouter defaults come from the curated catalog. Endpoint override is optional; execution stays gateway-only by default.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only supplies user-facing grouping.',
  },
  kimi: {
    productId: 'kimi',
    displayName: 'Kimi',
    family: 'Curated multi-variant API',
    description: 'Curated Kimi variants grouped under one product entry.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use a Kimi API key and choose the curated variant when needed.',
        authStrategy: 'api-key',
        defaultVariantId: 'kimi-intl-openai-general',
        variantIds: [
          'kimi-intl-openai-general',
          'kimi-cn-openai-general',
          'kimi-cn-anthropic-coding',
        ],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['kimi-intl-openai-general', 'kimi-cn-openai-general', 'kimi-cn-anthropic-coding'],
    advancedRoutingDescription:
      'Advanced routing chooses region/protocol variant. Default endpoint facts still come from the curated catalog.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only groups Kimi variants into one user-facing product.',
  },
  'qwen-model-studio': {
    productId: 'qwen-model-studio',
    displayName: 'Qwen / Model Studio',
    family: 'Manual-compatible API',
    description: 'Repo-owned Qwen placeholder until curated catalog coverage lands.',
    catalogSource: 'repo-owned',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Manual-compatible setup for Qwen / Alibaba Model Studio.',
        authStrategy: 'api-key',
        defaultVariantId: 'qwen-model-studio-manual',
        variantIds: ['qwen-model-studio-manual'],
        endpointOverrideMode: 'required',
      },
    ],
    variantIds: ['qwen-model-studio-manual'],
    advancedRoutingDescription:
      'Manual endpoint override is required until curated Qwen facts are available from provider-source-registry.',
    metadataOwnership:
      'Both product entry and transport placeholder are repo-owned for now; source-registry remains the future home for verified provider facts.',
  },
  minimax: {
    productId: 'minimax',
    displayName: 'MiniMax',
    family: 'Curated multi-variant API',
    description: 'Curated MiniMax variants grouped under one product entry.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use a MiniMax API key and choose the curated region variant when needed.',
        authStrategy: 'api-key',
        defaultVariantId: 'minimax-intl-anthropic-coding',
        variantIds: ['minimax-intl-anthropic-coding', 'minimax-cn-anthropic-coding'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['minimax-intl-anthropic-coding', 'minimax-cn-anthropic-coding'],
    advancedRoutingDescription:
      'Advanced routing chooses the curated MiniMax region variant; endpoint override is optional.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only groups MiniMax variants into one product.',
  },
  'zai-glm': {
    productId: 'zai-glm',
    displayName: 'GLM / Z.AI',
    family: 'Curated multi-variant API',
    description: 'Curated Z.AI / GLM variants grouped under one product entry.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use a Z.AI API key and choose the curated variant when needed.',
        authStrategy: 'api-key',
        defaultVariantId: 'zai-shared-openai-general',
        variantIds: [
          'zai-shared-openai-general',
          'zai-shared-openai-coding',
          'zai-shared-anthropic-coding',
        ],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: [
      'zai-shared-openai-general',
      'zai-shared-openai-coding',
      'zai-shared-anthropic-coding',
    ],
    advancedRoutingDescription:
      'Advanced routing chooses the curated Z.AI / GLM protocol variant; endpoint override remains optional.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only groups Z.AI variants into one product.',
  },
  'custom-compatible': {
    productId: 'custom-compatible',
    displayName: 'Custom Compatible',
    family: 'Manual-compatible API',
    description: 'Manual OpenAI-compatible fallback when no curated product fits.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Bring your own OpenAI-compatible endpoint.',
        authStrategy: 'api-key',
        defaultVariantId: 'custom',
        variantIds: ['custom'],
        endpointOverrideMode: 'required',
      },
    ],
    variantIds: ['custom'],
    advancedRoutingDescription:
      'Manual endpoint override is required. Custom-compatible stays on explicit transport profiles only.',
    metadataOwnership:
      'Transport placeholder comes from the curated catalog. Product taxonomy keeps it as the manual fallback bucket.',
  },
  gemini: {
    productId: 'gemini',
    displayName: 'Gemini',
    family: 'OpenAI-compatible API',
    description: 'Curated Gemini compatibility endpoint.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use the curated Gemini OpenAI-compatible endpoint.',
        authStrategy: 'api-key',
        defaultVariantId: 'gemini-openai-general',
        variantIds: ['gemini-openai-general'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['gemini-openai-general'],
    advancedRoutingDescription:
      'Gemini defaults come from the curated catalog; endpoint override is optional.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only supplies the user-facing product grouping.',
  },
  deepseek: {
    productId: 'deepseek',
    displayName: 'DeepSeek',
    family: 'OpenAI-compatible API',
    description: 'Curated DeepSeek compatibility endpoint.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description: 'Use the curated DeepSeek compatibility endpoint.',
        authStrategy: 'api-key',
        defaultVariantId: 'deepseek-openai-general',
        variantIds: ['deepseek-openai-general'],
        endpointOverrideMode: 'optional',
      },
    ],
    variantIds: ['deepseek-openai-general'],
    advancedRoutingDescription:
      'DeepSeek defaults come from the curated catalog; endpoint override is optional.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only supplies the user-facing product grouping.',
  },
  lmstudio: {
    productId: 'lmstudio',
    displayName: 'LM Studio',
    family: 'Local-compatible API',
    description: 'User-managed local OpenAI-compatible endpoint.',
    catalogSource: 'curated-catalog',
    defaultAccessMode: 'api-key',
    accessModes: [
      {
        accessMode: 'api-key',
        label: 'API key',
        description:
          'Local OpenAI-compatible endpoint with the conventional LM Studio placeholder key.',
        authStrategy: 'api-key',
        defaultVariantId: 'lmstudio',
        variantIds: ['lmstudio'],
        endpointOverrideMode: 'optional',
        defaultApiKeyValue: 'lm-studio',
      },
    ],
    variantIds: ['lmstudio'],
    advancedRoutingDescription:
      'LM Studio keeps the curated local endpoint as the default, with optional endpoint override for custom local bridges.',
    metadataOwnership:
      'Provider facts come from provider-source-registry curated catalog. Product taxonomy only supplies the user-facing product grouping.',
  },
};

export const DEFAULT_PROVIDER_PRODUCT_ID: ProviderProductId = 'minimax';

const PRODUCT_BY_VARIANT_ID: Readonly<Record<string, ProviderProductId>> = Object.freeze(
  Object.fromEntries(
    Object.values(PROVIDER_PRODUCTS).flatMap((product) =>
      product.variantIds.map((variantId) => [variantId, product.productId] as const),
    ),
  ) as Record<string, ProviderProductId>,
);

export function createCapabilities(overrides: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    streaming: true,
    thinking: false,
    toolCalls: false,
    toolStreaming: false,
    codingPlan: false,
    ...overrides,
  };
}

export function isProviderVendor(value: unknown): value is ProviderVendor {
  return typeof value === 'string' && PROVIDER_VENDORS.has(value as ProviderVendor);
}

export function isProviderRegion(value: unknown): value is ProviderRegion {
  return typeof value === 'string' && PROVIDER_REGIONS.has(value as ProviderRegion);
}

export function isProviderCompatibility(value: unknown): value is ProviderCompatibility {
  return typeof value === 'string' && PROVIDER_COMPATIBILITIES.has(value as ProviderCompatibility);
}

export function isProviderSurface(value: unknown): value is ProviderSurface {
  return typeof value === 'string' && PROVIDER_SURFACES.has(value as ProviderSurface);
}

export function isProviderProductId(value: unknown): value is ProviderProductId {
  return typeof value === 'string' && value in PROVIDER_PRODUCTS;
}

export function isProviderProductAccessMode(value: unknown): value is ProviderProductAccessMode {
  return value === 'api-key' || value === 'local-auth' || value === 'subscription';
}

export function isHostResolvedAccessMode(accessMode: ProviderProductAccessMode): boolean {
  return accessMode === 'local-auth' || accessMode === 'subscription';
}

export function getProviderProduct(
  productId: ProviderProductId | string | null | undefined,
): ProviderProductDefinition | undefined {
  return productId && isProviderProductId(productId) ? PROVIDER_PRODUCTS[productId] : undefined;
}

export function getAvailableProviderProducts(_options: {
  tauri: boolean;
}): Readonly<Record<ProviderProductId, ProviderProductDefinition>> {
  return PROVIDER_PRODUCTS;
}

export function getDefaultProviderProductId(_options: {
  tauri: boolean;
}): ProviderProductId {
  return DEFAULT_PROVIDER_PRODUCT_ID;
}

export function getProviderProductOrder(): readonly ProviderProductId[] {
  return PRODUCT_ORDER;
}

export function getProviderProductAccess(
  product: ProviderProductDefinition | undefined,
  accessMode: ProviderProductAccessMode | null | undefined,
): ProviderProductAccessDefinition | undefined {
  if (!product) return undefined;
  const match = accessMode
    ? product.accessModes.find((candidate) => candidate.accessMode === accessMode)
    : undefined;
  return match ?? product.accessModes[0];
}

export function getDefaultProviderAccessMode(
  productId: ProviderProductId | string | null | undefined,
): ProviderProductAccessMode {
  return getProviderProduct(productId)?.defaultAccessMode ?? 'api-key';
}

export function getProviderVariant(
  providerVariantId: string | null | undefined,
): ProviderVariantDefinition | undefined {
  if (!providerVariantId) return undefined;
  return PROVIDER_VARIANTS[providerVariantId];
}

export function getDefaultProviderVariantId(
  productId: ProviderProductId | string | null | undefined,
  accessMode?: ProviderProductAccessMode | null,
): string | undefined {
  const product = getProviderProduct(productId);
  const access = getProviderProductAccess(product, accessMode ?? undefined);
  return access?.defaultVariantId ?? access?.variantIds?.[0] ?? product?.variantIds[0];
}

export function listProviderVariantsForProduct(
  productId: ProviderProductId | string | null | undefined,
  accessMode?: ProviderProductAccessMode | null,
): readonly ProviderVariantDefinition[] {
  const product = getProviderProduct(productId);
  if (!product) return [];
  const access = getProviderProductAccess(product, accessMode ?? undefined);
  const variantIds = access?.variantIds ?? product.variantIds;
  return variantIds
    .map((providerVariantId) => PROVIDER_VARIANTS[providerVariantId])
    .filter((variant): variant is ProviderVariantDefinition => Boolean(variant));
}

export function findProviderProductIdByVariantId(
  providerVariantId: string | null | undefined,
): ProviderProductId | null {
  if (!providerVariantId) return null;
  return PRODUCT_BY_VARIANT_ID[providerVariantId] ?? null;
}

export function findProviderProductIdByLegacyRoute(input: {
  provider?: LlmProvider | string | null;
  providerVariantId?: string | null;
  vendor?: ProviderVendor | string | null;
  baseURL?: string | null;
  compatibility?: ProviderCompatibility | string | null;
}): ProviderProductId | null {
  if (input.providerVariantId) {
    const byVariant = findProviderProductIdByVariantId(input.providerVariantId);
    if (byVariant) return byVariant;
  }

  if (typeof input.baseURL === 'string' && input.baseURL.trim()) {
    const baseURL = input.baseURL.trim().toLowerCase();
    if (baseURL.includes('openrouter.ai')) return 'openrouter';
    if (baseURL.includes('api.minimax.io') || baseURL.includes('api.minimaxi.com')) {
      return 'minimax';
    }
    if (baseURL.includes('api.moonshot.ai') || baseURL.includes('api.moonshot.cn')) {
      return 'kimi';
    }
    if (baseURL.includes('api.z.ai')) return 'zai-glm';
    if (baseURL.includes('generativelanguage.googleapis.com')) return 'gemini';
    if (baseURL.includes('api.deepseek.com')) return 'deepseek';
    if (baseURL.includes('localhost:1234')) return 'lmstudio';
  }

  if (input.vendor && isProviderVendor(input.vendor)) {
    switch (input.vendor) {
      case 'openai':
        return 'openai-api';
      case 'anthropic':
        return 'anthropic-api';
      case 'openrouter':
        return 'openrouter';
      case 'minimax':
        return 'minimax';
      case 'kimi':
        return 'kimi';
      case 'zai':
        return 'zai-glm';
      case 'google':
        return 'gemini';
      case 'deepseek':
        return 'deepseek';
      case 'lmstudio':
        return 'lmstudio';
      case 'custom':
        return 'custom-compatible';
      case 'qwen':
        return 'qwen-model-studio';
      default:
        break;
    }
  }

  if (input.provider === 'openai' && input.compatibility === 'native') {
    return 'openai-api';
  }
  if (input.provider === 'anthropic' && input.compatibility === 'native') {
    return 'anthropic-api';
  }
  if (input.provider === 'openai-compat') {
    return 'custom-compatible';
  }

  return null;
}

export function getSupportedExecutionLanesForProduct(
  product: ProviderProductDefinition | undefined,
  accessMode: ProviderProductAccessMode | null | undefined,
  providerVariantId?: string | null,
): readonly LlmExecutionLane[] {
  const access = getProviderProductAccess(product, accessMode ?? undefined);
  const variant = getProviderVariant(providerVariantId ?? access?.defaultVariantId ?? null);
  const lanes = variant?.supportedExecutionLanes ?? access?.supportedExecutionLanes ?? [];
  return dedupeExecutionLanes(lanes.length > 0 ? lanes : [DEFAULT_EXECUTION_LANE]);
}

function buildCuratedProviderVariants(): Record<string, ProviderVariantDefinition> {
  const providers = (curatedCatalog as CuratedCatalogShape).providers;
  const variants = Object.entries(providers).flatMap(([providerVariantId, entry]) => {
    const productId = CURATED_VARIANT_PRODUCT_IDS[providerVariantId];
    if (!productId) return [];
    const modelIds = Object.keys(entry.models ?? {});
    const modelDisplayNames = Object.fromEntries(
      Object.entries(entry.models ?? {}).map(([modelId, model]) => [
        modelId,
        model.displayName ?? modelId,
      ]),
    );

    return [
      [
        providerVariantId,
        {
          productId,
          providerVariantId,
          provider: entry.providerTransport,
          displayName: entry.productName,
          productName: entry.productName,
          catalogSource: 'curated-catalog' as const,
          vendor: entry.vendor,
          compatibility: entry.compatibility,
          region: entry.region,
          surface: entry.surface,
          baseURL: entry.baseURL ?? undefined,
          defaultModel: entry.defaultModel ?? modelIds[0],
          supportedExecutionLanes: dedupeExecutionLanes(
            CURATED_VARIANT_LANES[providerVariantId] ??
              entry.executionLaneHints?.productExposed ?? [DEFAULT_EXECUTION_LANE],
          ),
          modelIds,
          authMode: mapCatalogAuthMode(entry.authMode),
          capabilities:
            CURATED_VARIANT_CAPABILITIES[providerVariantId] ?? deriveCapabilitiesFromCatalog(entry),
          communityDisplayName: entry.communityDisplayName,
          communityDocsUrl: entry.communityDocsUrl,
          modelDisplayNames,
          notes: entry.notes,
        } satisfies ProviderVariantDefinition,
      ],
    ];
  });

  return Object.fromEntries(variants);
}

function mapCatalogAuthMode(value: string | undefined): ProviderProductAccessMode {
  return value === 'local-auth' || value === 'subscription' ? value : 'api-key';
}

function deriveCapabilitiesFromCatalog(entry: CuratedCatalogProviderEntry): ProviderCapabilities {
  const supportedEndpoints = new Set(entry.supportedEndpoints ?? []);
  return createCapabilities({
    toolCalls:
      supportedEndpoints.has('responses') ||
      supportedEndpoints.has('messages') ||
      supportedEndpoints.has('chat_completions'),
    codingPlan: entry.surface === 'coding-plan',
  });
}

function dedupeExecutionLanes(
  lanes: ReadonlyArray<LlmExecutionLane> | undefined,
): readonly LlmExecutionLane[] {
  if (!lanes || lanes.length === 0) return [DEFAULT_EXECUTION_LANE];
  return Array.from(new Set(lanes));
}
