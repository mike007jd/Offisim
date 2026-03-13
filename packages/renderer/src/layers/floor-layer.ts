// ── Floor layer ──────────────────────────────────────────────────────
// Draws the full R&D office floor plan from a computed OfficeFloorPlan.
// Uses vector furniture shapes — no pixel art.

import { Container, Graphics, Text } from 'pixi.js';
import gsap from 'gsap';
import type { OfficeFloorPlan, ZoneBounds, DeskPosition } from '../layout/zone-layout-engine.js';
import {
  drawDesk,
  drawChair,
  drawMonitor,
  drawBookshelf,
  drawReadingTable,
  drawSofa,
  drawCoffeeTable,
  drawPlant,
  drawVendingMachine,
} from '../shapes/furniture.js';

/** Re-export DeskPosition for backward compat with InteractionController */
export type { DeskPosition } from '../layout/zone-layout-engine.js';

/** Axis-aligned bounding box for workstation hit-testing. */
export interface WorkstationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Highlight color for drop-target feedback (amber-400). */
const HIGHLIGHT_COLOR = 0xfbbf24;
const HIGHLIGHT_ALPHA = 0.25;
const HIGHLIGHT_BORDER_ALPHA = 0.6;

/** Meeting active overlay color (amber-300). */
const MEETING_ACTIVE_COLOR = 0xfcd34d;
/** Meeting scheduled border color (amber-400). */
const MEETING_SCHEDULED_COLOR = 0xfbbf24;

/** Workstation hit-test area around each desk center. */
const WS_HALF_W = 35;
const WS_HALF_H = 30;

export class FloorLayer {
  readonly container: Container;
  private readonly plan: OfficeFloorPlan;
  private highlights: Map<string, Graphics> = new Map();
  private highlightContainer: Container;
  /** Meeting active glow overlays keyed by zoneId. */
  private meetingOverlays: Map<string, Graphics> = new Map();
  /** Meeting scheduled border overlays keyed by zoneId. */
  private meetingScheduledOverlays: Map<string, Graphics> = new Map();
  /** GSAP tweens for meeting overlays, keyed by zoneId, for cleanup. */
  private meetingTweens: Map<string, gsap.core.Tween[]> = new Map();
  /** Registered zone bounds for meeting rooms, keyed by zoneId. */
  private meetingZones: Map<string, ZoneBounds> = new Map();

  constructor(plan: OfficeFloorPlan) {
    this.plan = plan;
    this.container = new Container();
    this.highlightContainer = new Container();

    this.drawFloor();
    this.drawZoneBorders();
    this.drawZoneLabels();
    this.container.addChild(this.highlightContainer);
    this.drawDesks();
    this.drawFunctionalZones();
  }

  /** Get desk positions from the floor plan. */
  getDeskPositions(): DeskPosition[] {
    return this.plan.zones.flatMap((z) => z.workstations);
  }

  /** Get workstation bounds for drag-drop hit-testing. */
  getWorkstationBounds(): Map<string, WorkstationBounds> {
    const result = new Map<string, WorkstationBounds>();
    for (const [wsId, pos] of this.plan.allWorkstations) {
      result.set(wsId, {
        x: pos.x - WS_HALF_W,
        y: pos.y - WS_HALF_H,
        width: WS_HALF_W * 2,
        height: WS_HALF_H * 2,
      });
    }
    return result;
  }

  /** Show or hide a highlight overlay on a workstation (for drop-target feedback). */
  setWorkstationHighlight(workstationId: string, on: boolean): void {
    const existing = this.highlights.get(workstationId);

    if (!on) {
      if (existing) {
        this.highlightContainer.removeChild(existing);
        existing.destroy();
        this.highlights.delete(workstationId);
      }
      return;
    }
    if (existing) return;

    const bounds = this.getWorkstationBounds().get(workstationId);
    if (!bounds) return;

    const gfx = new Graphics();
    gfx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    gfx.fill({ color: HIGHLIGHT_COLOR, alpha: HIGHLIGHT_ALPHA });
    gfx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    gfx.stroke({ color: HIGHLIGHT_COLOR, alpha: HIGHLIGHT_BORDER_ALPHA, width: 2 });

    this.highlightContainer.addChild(gfx);
    this.highlights.set(workstationId, gfx);
  }

  /** Clear all workstation highlights. */
  clearAllHighlights(): void {
    for (const [id] of this.highlights) {
      this.setWorkstationHighlight(id, false);
    }
  }

  /**
   * Register a meeting room zone so that overlay methods can look up its bounds.
   * Falls back to floor plan zones if not explicitly registered.
   */
  registerMeetingZone(zoneId: string, bounds: ZoneBounds): void {
    this.meetingZones.set(zoneId, bounds);
  }

  /**
   * Show a pulsing glow overlay on a meeting room zone to indicate an active meeting.
   * Uses GSAP alpha breathing animation (0.05 ~ 0.15).
   */
  showMeetingActive(zoneId: string): void {
    if (this.meetingOverlays.has(zoneId)) return;

    const zone = this.meetingZones.get(zoneId)
      ?? this.plan.zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;

    const gfx = new Graphics();
    const radius = Math.round(Math.min(zone.width, zone.height) * 0.04);
    gfx.roundRect(zone.x, zone.y, zone.width, zone.height, radius);
    gfx.fill({ color: MEETING_ACTIVE_COLOR, alpha: 1 });
    gfx.alpha = 0.05;

    this.highlightContainer.addChild(gfx);
    this.meetingOverlays.set(zoneId, gfx);

    // Breathing animation
    const tw = gsap.to(gfx, {
      alpha: 0.15,
      duration: 1.5,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    this.storeMeetingTween(zoneId, tw);
  }

  /** Remove the active meeting glow overlay. */
  hideMeetingActive(zoneId: string): void {
    this.killMeetingTweens(zoneId);
    const gfx = this.meetingOverlays.get(zoneId);
    if (gfx) {
      this.highlightContainer.removeChild(gfx);
      gfx.destroy();
      this.meetingOverlays.delete(zoneId);
    }
  }

  /**
   * Show a dashed-border blink effect on a meeting room zone to indicate
   * a meeting is about to start.
   */
  showMeetingScheduled(zoneId: string): void {
    if (this.meetingScheduledOverlays.has(zoneId)) return;

    const zone = this.meetingZones.get(zoneId)
      ?? this.plan.zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;

    const gfx = new Graphics();
    const radius = Math.round(Math.min(zone.width, zone.height) * 0.04);
    gfx.roundRect(zone.x + 1, zone.y + 1, zone.width - 2, zone.height - 2, radius);
    gfx.stroke({ color: MEETING_SCHEDULED_COLOR, alpha: 0.6, width: 2 });
    gfx.alpha = 0.4;

    this.highlightContainer.addChild(gfx);
    this.meetingScheduledOverlays.set(zoneId, gfx);

    // Blink animation
    const tw = gsap.to(gfx, {
      alpha: 1,
      duration: 0.8,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
    this.storeMeetingTween(zoneId, tw);
  }

  /** Remove the scheduled meeting border overlay. */
  hideMeetingScheduled(zoneId: string): void {
    const gfx = this.meetingScheduledOverlays.get(zoneId);
    if (gfx) {
      // Kill tweens associated with this specific overlay
      const tweens = this.meetingTweens.get(zoneId);
      if (tweens) {
        const remaining: gsap.core.Tween[] = [];
        for (const tw of tweens) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const targets = (tw as any)._targets ?? [(tw as any)._target];
          if (targets && targets.includes(gfx)) {
            tw.kill();
          } else {
            remaining.push(tw);
          }
        }
        if (remaining.length > 0) {
          this.meetingTweens.set(zoneId, remaining);
        } else {
          this.meetingTweens.delete(zoneId);
        }
      }
      this.highlightContainer.removeChild(gfx);
      gfx.destroy();
      this.meetingScheduledOverlays.delete(zoneId);
    }
  }

  /** Get zone bounds by zoneId (for camera focusZone). */
  getZoneBounds(zoneId: string): ZoneBounds | undefined {
    return this.plan.zones.find((z) => z.zoneId === zoneId);
  }

  // ── Private drawing methods ──────────────────────────────────────

  /** Draw zone backgrounds as colored rectangles. */
  private drawFloor(): void {
    const g = new Graphics();

    // Overall background
    g.rect(0, 0, this.plan.totalWidth, this.plan.totalHeight);
    g.fill(0x111827);

    // Zone floors
    for (const zone of this.plan.zones) {
      g.roundRect(zone.x, zone.y, zone.width, zone.height, 6);
      g.fill(zone.floorColor);
    }

    this.container.addChild(g);
  }

  /** Draw subtle zone borders. */
  private drawZoneBorders(): void {
    const g = new Graphics();
    for (const zone of this.plan.zones) {
      g.roundRect(zone.x, zone.y, zone.width, zone.height, 6);
      g.stroke({ color: 0xffffff, alpha: 0.08, width: 1 });
    }
    this.container.addChild(g);
  }

  /** Draw zone labels (English abbreviation at top-left of each zone). */
  private drawZoneLabels(): void {
    for (const zone of this.plan.zones) {
      const label = new Text({
        text: zone.labelEn,
        style: {
          fontSize: 11,
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 'bold',
          letterSpacing: 1.5,
        },
      });
      label.alpha = 0.4;
      label.position.set(zone.x + 8, zone.y + 6);
      this.container.addChild(label);

      // Chinese label below
      const subLabel = new Text({
        text: zone.label,
        style: {
          fontSize: 8,
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
        },
      });
      subLabel.alpha = 0.25;
      subLabel.position.set(zone.x + 8, zone.y + 20);
      this.container.addChild(subLabel);
    }
  }

  /** Draw desks at each workstation position (department zones). */
  private drawDesks(): void {
    for (const zone of this.plan.zones) {
      if (zone.type !== 'department') continue;

      for (const ws of zone.workstations) {
        // Desk
        const deskGfx = new Graphics();
        drawDesk(deskGfx, 50, 28, 0x5c4033);
        deskGfx.position.set(ws.x, ws.y);
        this.container.addChild(deskGfx);

        // Monitor on desk
        const monGfx = new Graphics();
        drawMonitor(monGfx, 22, 18);
        monGfx.position.set(ws.x, ws.y - 18);
        this.container.addChild(monGfx);

        // Chair behind desk
        const chairGfx = new Graphics();
        drawChair(chairGfx, 20, 22, 0x2d3748);
        chairGfx.position.set(ws.x, ws.y + 22);
        this.container.addChild(chairGfx);
      }
    }
  }

  /** Draw functional zone furniture (library, rest area, meeting room). */
  private drawFunctionalZones(): void {
    for (const zone of this.plan.zones) {
      switch (zone.type) {
        case 'library':
          this.drawLibraryFurniture(zone);
          break;
        case 'rest_area':
          this.drawRestAreaFurniture(zone);
          break;
        case 'meeting_room':
          this.drawMeetingFurniture(zone);
          break;
      }
    }
  }

  /** Draw bookshelves and reading tables in the library zone. */
  private drawLibraryFurniture(zone: ZoneBounds): void {
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;

    // Bookshelves along the top
    const shelfCount = Math.max(2, Math.floor(zone.width / 60));
    const shelfGap = (zone.width - 40) / shelfCount;
    for (let i = 0; i < shelfCount; i++) {
      const shelfGfx = new Graphics();
      drawBookshelf(shelfGfx, 30, 40);
      shelfGfx.position.set(zone.x + 20 + i * shelfGap + shelfGap / 2, zone.y + 50);
      this.container.addChild(shelfGfx);
    }

    // Reading table in center
    const tableGfx = new Graphics();
    drawReadingTable(tableGfx, 36, 20, 0x6b5b3a);
    tableGfx.position.set(cx, cy + 15);
    this.container.addChild(tableGfx);

    // Plant in corner
    const plantGfx = new Graphics();
    drawPlant(plantGfx, 14, 22);
    plantGfx.position.set(zone.x + zone.width - 20, zone.y + zone.height - 20);
    this.container.addChild(plantGfx);
  }

  /** Draw sofas, coffee table, and vending machine in rest area. */
  private drawRestAreaFurniture(zone: ZoneBounds): void {
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;

    // Sofa
    const sofaGfx = new Graphics();
    drawSofa(sofaGfx, 44, 22, 0x6b21a8);
    sofaGfx.position.set(cx - 30, cy);
    this.container.addChild(sofaGfx);

    // Coffee table
    const tableGfx = new Graphics();
    drawCoffeeTable(tableGfx, 24, 16, 0x78350f);
    tableGfx.position.set(cx + 20, cy);
    this.container.addChild(tableGfx);

    // Vending machine
    const vendGfx = new Graphics();
    drawVendingMachine(vendGfx, 18, 32);
    vendGfx.position.set(zone.x + zone.width - 25, zone.y + 50);
    this.container.addChild(vendGfx);

    // Plant
    const plantGfx = new Graphics();
    drawPlant(plantGfx, 14, 22);
    plantGfx.position.set(zone.x + 20, zone.y + zone.height - 20);
    this.container.addChild(plantGfx);
  }

  private storeMeetingTween(zoneId: string, tw: gsap.core.Tween): void {
    const arr = this.meetingTweens.get(zoneId) ?? [];
    arr.push(tw);
    this.meetingTweens.set(zoneId, arr);
  }

  private killMeetingTweens(zoneId: string): void {
    const tweens = this.meetingTweens.get(zoneId);
    if (tweens) {
      for (const tw of tweens) tw.kill();
      this.meetingTweens.delete(zoneId);
    }
  }

  /** Draw a conference table and chairs in the meeting room zone. */
  private drawMeetingFurniture(zone: ZoneBounds): void {
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;

    // Large conference table
    const tableGfx = new Graphics();
    tableGfx.roundRect(-50, -30, 100, 60, 8);
    tableGfx.fill(0x4a3728);
    tableGfx.position.set(cx, cy);
    this.container.addChild(tableGfx);

    // Chairs around table (6)
    const chairPositions = [
      { x: cx - 35, y: cy - 40 },
      { x: cx, y: cy - 40 },
      { x: cx + 35, y: cy - 40 },
      { x: cx - 35, y: cy + 40 },
      { x: cx, y: cy + 40 },
      { x: cx + 35, y: cy + 40 },
    ];
    for (const pos of chairPositions) {
      const cGfx = new Graphics();
      drawChair(cGfx, 16, 18, 0x374151);
      cGfx.position.set(pos.x, pos.y);
      this.container.addChild(cGfx);
    }
  }
}
