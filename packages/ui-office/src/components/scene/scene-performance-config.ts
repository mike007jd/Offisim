export interface Office3DPerformanceConfig {
  dpr: [number, number];
  shadows: false | 'percentage';
  shadowMapSize: [number, number];
  environmentPreset: 'city' | null;
}

export function getOffice3DPerformanceConfig(isDev: boolean): Office3DPerformanceConfig {
  if (isDev) {
    return {
      dpr: [1, 1],
      shadows: false,
      shadowMapSize: [512, 512],
      environmentPreset: null,
    };
  }

  return {
    dpr: [1, 1.5],
    shadows: 'percentage',
    shadowMapSize: [1024, 1024],
    environmentPreset: 'city',
  };
}
