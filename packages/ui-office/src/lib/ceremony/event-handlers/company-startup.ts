import type { CompanyStartupPayload, RuntimeEvent } from '@offisim/shared-types';
import type { CeremonyEventBus, CeremonyHandlerContext } from '../ceremony-handler-context';

export function subscribeCompanyStartup(
  eventBus: CeremonyEventBus,
  ctx: CeremonyHandlerContext,
): () => void {
  return eventBus.on('company.startup.', (e: RuntimeEvent<CompanyStartupPayload>) => {
    const payload = e.payload;
    if (payload.companyId !== ctx.companyIdRef.current) return;

    if (payload.status === 'requested' || payload.status === 'started') {
      ctx.setCeremony((prev) => ({
        ...prev,
        startup: {
          active: true,
          startupId: payload.startupId,
          source: payload.source,
          replay: payload.isReplay,
        },
      }));
      return;
    }

    ctx.setCeremony((prev) => ({
      ...prev,
      startup: {
        active: false,
        startupId: payload.startupId,
        source: payload.source,
        replay: payload.isReplay,
      },
    }));
  });
}
