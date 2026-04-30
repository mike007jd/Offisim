export interface ShadowBiasInput {
  lightDistance: number;
  sceneScale: number;
}

export function computeShadowBias({ lightDistance, sceneScale }: ShadowBiasInput): number {
  const scale = Math.max(sceneScale, 0.1);
  const distance = Math.max(lightDistance, 1);
  return -0.00035 * scale * Math.min(distance / 28, 2);
}
