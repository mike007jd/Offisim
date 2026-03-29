import { describe, expect, it } from 'vitest';
import { getOffice3DPerformanceConfig } from '../../components/scene/scene-performance-config';

describe('getOffice3DPerformanceConfig', () => {
  it('uses a reduced quality profile in development', () => {
    expect(getOffice3DPerformanceConfig(true)).toEqual({
      dpr: [1, 1],
      environmentPreset: null,
      shadowMapSize: [512, 512],
      shadows: false,
    });
  });

  it('preserves the higher quality profile outside development', () => {
    expect(getOffice3DPerformanceConfig(false)).toEqual({
      dpr: [1, 1.5],
      environmentPreset: 'city',
      shadowMapSize: [1024, 1024],
      shadows: 'percentage',
    });
  });
});
