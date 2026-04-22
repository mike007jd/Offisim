import { ensureRuntimeBuild } from './harness-lib.mjs';

await ensureRuntimeBuild({ force: true });
console.log(
  JSON.stringify(
    {
      ok: true,
      built: [
        '@offisim/asset-schema',
        '@offisim/shared-types',
        '@offisim/install-core',
        '@offisim/db-local',
        '@offisim/core',
      ],
    },
    null,
    2,
  ),
);
