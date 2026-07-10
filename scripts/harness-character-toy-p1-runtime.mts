#!/usr/bin/env tsx
import { runToyCharacterRuntimeOracle } from '../apps/desktop/renderer/src/surfaces/office/scene/character/toy-character-oracle.ts';

const bodyUrl = new URL(
  '../apps/desktop/renderer/src/assets/characters/body_toy.glb',
  import.meta.url,
);
await runToyCharacterRuntimeOracle(bodyUrl);
console.log('PASS harness-character-toy-p1-runtime');
