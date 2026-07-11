import { isTauriRuntime } from '@/data/adapters.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { readPiModelOverride, writePiModelOverride } from '@/runtime/pi-agent-config.js';
import { usePiThreadModelStore } from '@/runtime/pi-thread-model-store.js';
import { useQuery } from '@tanstack/react-query';

/** One Pi-available model, as projected by the `pi_agent_status` command. */
interface PiAgentModelOption {
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

function modelValue(model: PiAgentModelSummary): string {
  const id = model.id ?? model.name ?? 'model';
  return model.provider ? `${model.provider}/${id}` : id;
}

async function loadModels(): Promise<PiAgentModelOption[]> {
  const status = await invokeCommand('pi_agent_status');
  const models = status.availableModels ?? [];
  const options = models.map((model) => ({
    value: modelValue(model),
    name: model.id ?? model.name ?? 'model',
    provider: model.provider ?? 'pi',
    reasoning: model.reasoning === true,
  }));
  // Pi's list is the only truth for what can run. Persisted picks (the global
  // Settings override and per-thread selections) that no longer exist there
  // are cleared, never displayed or sent — no phantom defaults.
  const valid = options.map((option) => option.value);
  const override = readPiModelOverride();
  if (override && !valid.includes(override)) writePiModelOverride('');
  usePiThreadModelStore.getState().pruneInvalidModels(valid);
  return options;
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
