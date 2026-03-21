/**
 * PrefabRuntime — manages a single prefab instance in the PixiJS scene.
 *
 * Key design:
 * - Pre-builds one GraphicsContext per state at construction time.
 * - State changes swap `graphics.context` — O(1) pointer assignment, no redraw.
 * - GSAP alpha pulse on transition for visual feedback.
 * - Binding slots connect prefab instances to runtime resources.
 */
import { Container, Graphics, type GraphicsContext } from 'pixi.js';
import gsap from 'gsap';
import type { PrefabDefinition, PrefabBinding } from '@aics/shared-types';
import { canTransition, getInitialState, getAllStates } from './state-machines.js';
import { getTemplate, buildStateContexts } from './render-templates.js';

export class PrefabRuntime {
  readonly instanceId: string;
  readonly definition: PrefabDefinition;
  readonly container: Container;

  currentState: string;

  /** Pre-built GraphicsContext per state (for atomic) or per child per state (for composite) */
  private stateContexts: Map<string, GraphicsContext> | null = null;
  private childStateContexts: Map<string, GraphicsContext>[] = [];
  private childGraphics: Graphics[] = [];

  /** Event unsubscribe functions */
  eventUnsubscribers: Array<() => void> = [];

  /** Bindings */
  private bindings: Map<string, PrefabBinding> = new Map();

  constructor(
    instanceId: string,
    definition: PrefabDefinition,
    configOverrides?: Record<string, unknown>,
  ) {
    this.instanceId = instanceId;
    this.definition = definition;
    this.container = new Container();

    // Get initial state
    const initial = getInitialState(definition.category);
    this.currentState = initial ?? 'static';

    // Build graphics — copy states into mutable array since getAllStates returns readonly
    const states: string[] = [...getAllStates(definition.category)];
    if (states.length === 0) states.push('static'); // decorative

    if (definition.composite && definition.children) {
      // Composite: each child gets its own Graphics + stateContexts
      for (const child of definition.children) {
        const templateFn = getTemplate(child.render2D.template);
        if (!templateFn) continue;
        const params = { ...child.render2D.params, ...(configOverrides ?? {}) };
        const childContexts = buildStateContexts(templateFn, params, states);
        const g = new Graphics();
        g.context = childContexts.get(this.currentState)!;
        g.x = child.offset[0];
        g.y = child.offset[1];
        this.container.addChild(g);
        this.childGraphics.push(g);
        this.childStateContexts.push(childContexts);
      }
    } else if (definition.render2D) {
      // Atomic: single Graphics
      const templateFn = getTemplate(definition.render2D.template);
      if (templateFn) {
        const params = { ...definition.render2D.params, ...(configOverrides ?? {}) };
        this.stateContexts = buildStateContexts(templateFn, params, states);
        const g = new Graphics();
        g.context = this.stateContexts.get(this.currentState)!;
        this.container.addChild(g);
        this.childGraphics.push(g);
      }
    }
  }

  /** Transition to a new state — swaps GraphicsContext, no redraw */
  setState(next: string): boolean {
    if (this.definition.category === 'decorative') return false;
    if (!canTransition(this.definition.category, this.currentState, next)) return false;

    this.currentState = next;

    // Swap contexts on all graphics
    if (this.stateContexts) {
      // Atomic
      const ctx = this.stateContexts.get(next);
      if (ctx && this.childGraphics[0]) {
        this.childGraphics[0].context = ctx;
      }
    } else {
      // Composite
      for (let i = 0; i < this.childGraphics.length; i++) {
        const ctx = this.childStateContexts[i]?.get(next);
        const g = this.childGraphics[i];
        if (ctx && g) g.context = ctx;
      }
    }

    // GSAP transition (alpha pulse), overwrite: 'auto' to prevent conflicts
    gsap.fromTo(this.container, { alpha: 0.7 }, { alpha: 1, duration: 0.3, overwrite: 'auto' });

    return true;
  }

  /** Bind a resource to a slot */
  bindToResource(slotName: string, resourceRef: string, label?: string): void {
    this.bindings.set(slotName, { slotName, resourceRef, label });
  }

  /** Unbind a resource */
  unbindResource(slotName: string): void {
    this.bindings.delete(slotName);
  }

  /** Get binding for a slot */
  getBinding(slotName: string): PrefabBinding | undefined {
    return this.bindings.get(slotName);
  }

  /** Get all bindings */
  getAllBindings(): PrefabBinding[] {
    return [...this.bindings.values()];
  }

  /** Clean up */
  destroy(): void {
    gsap.killTweensOf(this.container);
    for (const unsub of this.eventUnsubscribers) unsub();
    this.eventUnsubscribers.length = 0;
    this.bindings.clear();

    // Destroy graphics
    for (const g of this.childGraphics) g.destroy();
    this.childGraphics.length = 0;

    // Destroy contexts
    if (this.stateContexts) {
      for (const ctx of this.stateContexts.values()) ctx.destroy();
      this.stateContexts = null;
    }
    for (const map of this.childStateContexts) {
      for (const ctx of map.values()) ctx.destroy();
    }
    this.childStateContexts.length = 0;

    this.container.destroy();
  }
}
