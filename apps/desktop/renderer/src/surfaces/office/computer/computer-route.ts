import type {
  RuntimeEngineCapabilityManifest,
  RuntimeInteractionRoute,
} from '@offisim/shared-types';

interface EffectiveComputerRoute extends RuntimeInteractionRoute {
  readonly availability: 'available' | 'setup-required' | 'unsupported';
}

export interface ComputerRouteResolution {
  readonly effective: EffectiveComputerRoute;
  readonly routes: readonly EffectiveComputerRoute[];
}

function resolveAvailability(
  route: RuntimeInteractionRoute,
  localDriverReady: boolean,
): EffectiveComputerRoute {
  if (route.availability !== 'runtime-determined') {
    return route as EffectiveComputerRoute;
  }
  return {
    ...route,
    availability: localDriverReady ? 'available' : 'setup-required',
    ...(!localDriverReady && !route.reason
      ? { reason: 'Connect the Offisim desktop driver to use this route.' }
      : {}),
  };
}

function unavailableRoute(reason: string): EffectiveComputerRoute {
  return {
    id: 'computer-unavailable',
    source: 'offisim-local',
    label: 'Computer Use unavailable',
    availability: 'unsupported',
    reason,
  };
}

/** Resolve the Computer route that the current runtime can actually honour.
 * Available engine-native routes take precedence, then Offisim's local driver.
 * The UI stays read-only until runtime dispatch can consume a user preference. */
export function resolveComputerRoute(
  manifest: RuntimeEngineCapabilityManifest | undefined,
  localDriverReady: boolean,
): ComputerRouteResolution {
  const routes = (manifest?.interactionRoutes.computer ?? []).map((route) =>
    resolveAvailability(route, localDriverReady),
  );
  const available = routes.filter((route) => route.availability === 'available');

  const effective =
    available.find((route) => route.source === 'engine-native') ??
    available.find((route) => route.source === 'offisim-local') ??
    available[0] ??
    routes.find((route) => route.source === 'offisim-local') ??
    routes[0] ??
    unavailableRoute('This engine does not declare a Computer route.');
  return { effective, routes };
}
