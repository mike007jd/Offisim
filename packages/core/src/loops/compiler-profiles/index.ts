/**
 * Compiler profile registry (PR-07). Maps a profileId to its
 * {@link LoopCompilerProfile}. The first built-in is software-development (bundled
 * fleet-development-loop). Future profiles (research/content/operations) register
 * here without touching the generic IR/validator/service.
 */

import type { LoopCompilerProfile } from '../types.js';
import {
  SOFTWARE_DEVELOPMENT_PROFILE_ID,
  softwareDevelopmentProfile,
} from './software-development/index.js';

const PROFILES = new Map<string, LoopCompilerProfile>([
  [SOFTWARE_DEVELOPMENT_PROFILE_ID, softwareDevelopmentProfile],
]);

/** The default profile id new Loops author with. */
export const DEFAULT_COMPILER_PROFILE_ID = SOFTWARE_DEVELOPMENT_PROFILE_ID;

export function getCompilerProfile(profileId: string): LoopCompilerProfile | undefined {
  return PROFILES.get(profileId);
}

export function listCompilerProfiles(): LoopCompilerProfile[] {
  return [...PROFILES.values()];
}

export { SOFTWARE_DEVELOPMENT_PROFILE_ID, softwareDevelopmentProfile };
