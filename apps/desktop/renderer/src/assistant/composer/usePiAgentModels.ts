import { isTauriRuntime } from '@/data/adapters.js';
import { useQuery } from '@tanstack/react-query';

/** One Pi-available model, as projected by the `pi_agent_status` command. */
export interface PiAgentModelOption {
  /** `provider/id` registry label — the value forwarded to the Pi host. */
  value: string;
  /** Short model id for display (e.g. `glm-4.6`). */
  name: string;
  provider: string;
  reasoning: boolean;
}

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  name?: string;
  reasoning?: boolean;
}

interface PiAgentStatusResponse {
  availableModels?: PiAgentModelSummary[];
}

function modelValue(model: PiAgentModelSummary): string {
  const id = model.id ?? model.name ?? 'model';
  return model.provider ? `${model.provider}/${id}` : id;
}

async function loadModels(): Promise<PiAgentModelOption[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const status = await invoke<PiAgentStatusResponse>('pi_agent_status');
  const models = status.availableModels ?? [];
  return models.map((model) => ({
    value: modelValue(model),
    name: model.id ?? model.name ?? 'model',
    provider: model.provider ?? 'pi',
    reasoning: model.reasoning === true,
  }));
}

/**
 * The models Pi has valid auth for, grouped-friendly for the composer picker.
 * Only meaningful in the desktop runtime; the browser preview returns an empty
 * list (the picker then just shows the Pi default). Cached for the session.
 */
export function usePiAgentModels() {
  return useQuery({
    queryKey: ['pi-agent', 'models'],
    queryFn: loadModels,
    enabled: isTauriRuntime(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
