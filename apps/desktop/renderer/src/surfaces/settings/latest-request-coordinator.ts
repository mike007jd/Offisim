/**
 * Issues monotonically increasing request generations so async UI work can
 * discard responses that are no longer authoritative.
 */
export class LatestRequestCoordinator {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
