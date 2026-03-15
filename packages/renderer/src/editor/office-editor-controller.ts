// ── Office Editor Controller ────────────────────────────────────────
// Master controller for the 2D spatial office editor.
// Manages editor mode lifecycle, tool dispatching, and rendering.
// Communicates with DOM UI via the SceneEventBus.

import { Application, Container, Graphics, Text } from 'pixi.js';
import type { SceneEventBus } from '../core/types.js';
import type { ZoneType } from '../tokens/departments.js';
import { EditorGrid, GRID_SIZE } from './editor-grid.js';
import { SelectionHandler, type ResizeCorner } from './selection-handler.js';
import { ZoneTool } from './zone-tool.js';
import { DeskTool } from './desk-tool.js';
import { RoomTool } from './room-tool.js';
import type {
  EditorTool,
  EditorZone,
  EditorDesk,
  EditorRoom,
  EditorSelection,
  EditorStateSnapshot,
  OfficeTheme,
  OfficeTemplate,
  RoomType,
} from './types.js';
import { THEME_PALETTES } from './types.js';

/** Default canvas size. */
const DEFAULT_CANVAS_W = 1600;
const DEFAULT_CANVAS_H = 1000;

/** Blue tint overlay alpha for editor mode indicator. */
const EDITOR_TINT_ALPHA = 0.04;

/**
 * OfficeEditorController manages the entire editor session.
 * It creates its own PixiJS Application (separate from the runtime scene)
 * and provides a full editing workflow.
 */
export class OfficeEditorController {
  private app: Application | null = null;
  private worldContainer: Container | null = null;
  private _destroyed = false;

  // ── Data ──
  private zones: EditorZone[] = [];
  private desks: EditorDesk[] = [];
  private rooms: EditorRoom[] = [];
  private canvasWidth = DEFAULT_CANVAS_W;
  private canvasHeight = DEFAULT_CANVAS_H;

  // ── State ──
  private _tool: EditorTool = 'select';
  private _theme: OfficeTheme = 'default';
  private _gridVisible = true;

  // ── Sub-modules ──
  private grid: EditorGrid | null = null;
  private selectionHandler: SelectionHandler | null = null;
  private zoneTool: ZoneTool | null = null;
  private roomTool = new RoomTool();

  // ── Rendering layers ──
  private backgroundLayer: Container | null = null;
  private zoneLayer: Container | null = null;
  private deskLayer: Container | null = null;
  private roomLayer: Container | null = null;
  private overlayLayer: Container | null = null;

  // ── Drag state ──
  private dragState: {
    kind: 'move-zone' | 'move-desk' | 'move-room' | 'resize';
    id: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    resizeCorner?: ResizeCorner;
    originalBounds?: { x: number; y: number; width: number; height: number };
  } | null = null;

  // ── Event listeners for cleanup ──
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly eventBus: SceneEventBus,
  ) {}

  // ── Getters ──

  get tool(): EditorTool { return this._tool; }
  get theme(): OfficeTheme { return this._theme; }
  get gridVisible(): boolean { return this._gridVisible; }
  get selection(): EditorSelection { return this.selectionHandler?.selection ?? { kind: 'none' }; }

  /** Get a snapshot of the current editor state (for DOM UI sync). */
  getState(): EditorStateSnapshot {
    return {
      tool: this._tool,
      theme: this._theme,
      selection: this.selectionHandler?.selection ?? { kind: 'none' },
      zones: [...this.zones],
      desks: [...this.desks],
      rooms: [...this.rooms],
      gridVisible: this._gridVisible,
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
    };
  }

  // ── Mount / Destroy ──

  async mount(): Promise<void> {
    if (this.app || this._destroyed) return;

    const app = new Application();
    await app.init({
      resizeTo: this.container,
      background: THEME_PALETTES[this._theme].background,
      antialias: true,
      resolution: (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1,
      autoDensity: true,
    });

    if (this._destroyed) {
      app.destroy(true);
      return;
    }

    this.container.appendChild(app.canvas as HTMLCanvasElement);
    this.app = app;

    // ── Build scene graph ──
    this.worldContainer = new Container();
    app.stage.addChild(this.worldContainer);

    this.backgroundLayer = new Container();
    this.zoneLayer = new Container();
    this.deskLayer = new Container();
    this.roomLayer = new Container();
    this.overlayLayer = new Container();

    this.worldContainer.addChild(this.backgroundLayer);
    this.worldContainer.addChild(this.zoneLayer);
    this.worldContainer.addChild(this.deskLayer);
    this.worldContainer.addChild(this.roomLayer);
    this.worldContainer.addChild(this.overlayLayer);

    // ── Grid ──
    this.grid = new EditorGrid(this.canvasWidth, this.canvasHeight);
    this.grid.theme = this._theme;
    this.backgroundLayer.addChild(this.grid.container);

    // ── Selection handler ──
    this.selectionHandler = new SelectionHandler();
    this.overlayLayer.addChild(this.selectionHandler.container);

    // ── Zone tool ──
    this.zoneTool = new ZoneTool(this.overlayLayer);

    // ── Editor tint overlay ──
    this.drawEditorTint();

    // ── Attach pointer events ──
    this.attachPointerEvents(app);

    // ── Subscribe to EventBus commands from DOM UI ──
    this.subscribeEditorEvents();

    // ── Initial render ──
    this.renderAll();
    this.emitStateChange();
  }

  destroy(): void {
    this._destroyed = true;

    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];

    this.grid?.destroy();
    this.selectionHandler?.destroy();
    this.zoneTool?.destroy();

    if (this.app) {
      this.app.destroy(true, { children: true });
      this.app = null;
    }
    this.worldContainer = null;
  }

  // ── Tool / State setters ──

  setTool(tool: EditorTool): void {
    this._tool = tool;
    this.zoneTool?.cancelDraw();
    this.emitStateChange();
  }

  setTheme(theme: OfficeTheme): void {
    this._theme = theme;
    if (this.grid) this.grid.theme = theme;
    if (this.app) {
      this.app.renderer.background.color = THEME_PALETTES[theme].background;
    }
    this.renderAll();
    this.emitStateChange();
  }

  setGridVisible(v: boolean): void {
    this._gridVisible = v;
    if (this.grid) this.grid.visible = v;
    this.emitStateChange();
  }

  // ── Zone operations ──

  addZone(zone: EditorZone): void {
    this.zones.push(zone);
    this.renderAll();
    this.emitStateChange();
  }

  updateZone(id: string, patch: Partial<EditorZone>): void {
    const zone = this.zones.find((z) => z.id === id);
    if (!zone) return;
    Object.assign(zone, patch);
    this.renderAll();
    this.emitStateChange();
  }

  removeZone(id: string): void {
    this.zones = this.zones.filter((z) => z.id !== id);
    // Remove desks in this zone
    this.desks = this.desks.filter((d) => d.zoneId !== id);
    if (this.selectionHandler?.selection.kind === 'zone' && this.selectionHandler.selection.id === id) {
      this.selectionHandler.deselect();
    }
    this.renderAll();
    this.emitStateChange();
  }

  // ── Desk operations ──

  addDesk(desk: EditorDesk): void {
    this.desks.push(desk);
    this.renderAll();
    this.emitStateChange();
  }

  removeDesk(id: string): void {
    this.desks = this.desks.filter((d) => d.id !== id);
    if (this.selectionHandler?.selection.kind === 'desk' && this.selectionHandler.selection.id === id) {
      this.selectionHandler.deselect();
    }
    this.renderAll();
    this.emitStateChange();
  }

  updateDesk(id: string, patch: Partial<EditorDesk>): void {
    const desk = this.desks.find((d) => d.id === id);
    if (!desk) return;
    Object.assign(desk, patch);
    this.renderAll();
    this.emitStateChange();
  }

  // ── Room operations ──

  addRoom(room: EditorRoom): void {
    this.rooms.push(room);
    this.renderAll();
    this.emitStateChange();
  }

  removeRoom(id: string): void {
    this.rooms = this.rooms.filter((r) => r.id !== id);
    if (this.selectionHandler?.selection.kind === 'room' && this.selectionHandler.selection.id === id) {
      this.selectionHandler.deselect();
    }
    this.renderAll();
    this.emitStateChange();
  }

  updateRoom(id: string, patch: Partial<EditorRoom>): void {
    const room = this.rooms.find((r) => r.id === id);
    if (!room) return;
    Object.assign(room, patch);
    this.renderAll();
    this.emitStateChange();
  }

  // ── Selection ──

  selectElement(sel: EditorSelection): void {
    this.selectionHandler?.select(sel, this.zones, this.desks, this.rooms);
    this.renderAll();
    this.emitStateChange();
  }

  deselectAll(): void {
    this.selectionHandler?.deselect();
    this.renderAll();
    this.emitStateChange();
  }

  // ── Template ──

  /** Export current layout as a template. */
  exportTemplate(name: string): OfficeTemplate {
    return {
      name,
      theme: this._theme,
      zones: JSON.parse(JSON.stringify(this.zones)),
      desks: JSON.parse(JSON.stringify(this.desks)),
      rooms: JSON.parse(JSON.stringify(this.rooms)),
      canvasWidth: this.canvasWidth,
      canvasHeight: this.canvasHeight,
    };
  }

  /** Load a template, replacing current layout. */
  loadTemplate(template: OfficeTemplate): void {
    this.zones = JSON.parse(JSON.stringify(template.zones));
    this.desks = JSON.parse(JSON.stringify(template.desks));
    this.rooms = JSON.parse(JSON.stringify(template.rooms));
    this.canvasWidth = template.canvasWidth;
    this.canvasHeight = template.canvasHeight;
    this._theme = template.theme;

    if (this.grid) {
      this.grid.resize(this.canvasWidth, this.canvasHeight);
      this.grid.theme = this._theme;
    }
    if (this.app) {
      this.app.renderer.background.color = THEME_PALETTES[this._theme].background;
    }
    this.selectionHandler?.deselect();
    this.renderAll();
    this.emitStateChange();
  }

  // ── Built-in Templates ──

  static getBuiltInTemplates(): OfficeTemplate[] {
    return [
      OfficeEditorController.createRDCompanyTemplate(),
      OfficeEditorController.createContentStudioTemplate(),
      OfficeEditorController.createProductTeamTemplate(),
    ];
  }

  private static createRDCompanyTemplate(): OfficeTemplate {
    return {
      name: 'R&D Company',
      theme: 'default',
      canvasWidth: 1600,
      canvasHeight: 1000,
      zones: [
        { id: 'z-dev', type: 'department', label: '开发部门', labelEn: 'DEV', x: 32, y: 32, width: 480, height: 320, floorColor: 0x2a3a5c },
        { id: 'z-prod', type: 'department', label: '产品部门', labelEn: 'PROD', x: 544, y: 32, width: 320, height: 320, floorColor: 0x3a2a5c },
        { id: 'z-art', type: 'department', label: '美术部门', labelEn: 'ART', x: 896, y: 32, width: 320, height: 320, floorColor: 0x6b4530 },
      ],
      desks: [
        // DEV zone desks (3x2 grid)
        { id: 'd-1', zoneId: 'z-dev', x: 128, y: 128 },
        { id: 'd-2', zoneId: 'z-dev', x: 256, y: 128 },
        { id: 'd-3', zoneId: 'z-dev', x: 384, y: 128 },
        { id: 'd-4', zoneId: 'z-dev', x: 128, y: 256 },
        { id: 'd-5', zoneId: 'z-dev', x: 256, y: 256 },
        { id: 'd-6', zoneId: 'z-dev', x: 384, y: 256 },
        // PROD zone desks
        { id: 'd-7', zoneId: 'z-prod', x: 640, y: 128 },
        { id: 'd-8', zoneId: 'z-prod', x: 768, y: 128 },
        { id: 'd-9', zoneId: 'z-prod', x: 640, y: 256 },
        { id: 'd-10', zoneId: 'z-prod', x: 768, y: 256 },
        // ART zone desks
        { id: 'd-11', zoneId: 'z-art', x: 992, y: 128 },
        { id: 'd-12', zoneId: 'z-art', x: 1120, y: 128 },
        { id: 'd-13', zoneId: 'z-art', x: 992, y: 256 },
        { id: 'd-14', zoneId: 'z-art', x: 1120, y: 256 },
      ],
      rooms: [
        { id: 'r-lib', type: 'library', label: '图书馆', x: 32, y: 384, width: 320, height: 192, floorColor: 0x2a5c3a },
        { id: 'r-rest', type: 'rest_area', label: '休息区', x: 384, y: 384, width: 288, height: 192, floorColor: 0x4a4a3a },
        { id: 'r-mtg', type: 'meeting_room', label: '会议室', x: 704, y: 384, width: 320, height: 192, floorColor: 0x3a4a5c },
      ],
    };
  }

  private static createContentStudioTemplate(): OfficeTemplate {
    return {
      name: 'Content Studio',
      theme: 'warm',
      canvasWidth: 1280,
      canvasHeight: 960,
      zones: [
        { id: 'z-edit', type: 'department', label: '编辑部', labelEn: 'EDIT', x: 32, y: 32, width: 384, height: 288, floorColor: 0x3a2a5c },
        { id: 'z-design', type: 'department', label: '设计部', labelEn: 'ART', x: 448, y: 32, width: 384, height: 288, floorColor: 0x6b4530 },
      ],
      desks: [
        { id: 'd-1', zoneId: 'z-edit', x: 128, y: 128 },
        { id: 'd-2', zoneId: 'z-edit', x: 288, y: 128 },
        { id: 'd-3', zoneId: 'z-edit', x: 128, y: 224 },
        { id: 'd-4', zoneId: 'z-edit', x: 288, y: 224 },
        { id: 'd-5', zoneId: 'z-design', x: 544, y: 128 },
        { id: 'd-6', zoneId: 'z-design', x: 704, y: 128 },
        { id: 'd-7', zoneId: 'z-design', x: 544, y: 224 },
        { id: 'd-8', zoneId: 'z-design', x: 704, y: 224 },
      ],
      rooms: [
        { id: 'r-mtg', type: 'meeting_room', label: '会议室', x: 32, y: 352, width: 384, height: 192, floorColor: 0x3a4a5c },
        { id: 'r-rest', type: 'rest_area', label: '休息区', x: 448, y: 352, width: 384, height: 192, floorColor: 0x4a4a3a },
        { id: 'r-lib', type: 'library', label: '资料室', x: 32, y: 576, width: 800, height: 160, floorColor: 0x2a5c3a },
      ],
    };
  }

  private static createProductTeamTemplate(): OfficeTemplate {
    return {
      name: 'Product Team',
      theme: 'dark',
      canvasWidth: 1280,
      canvasHeight: 800,
      zones: [
        { id: 'z-pm', type: 'department', label: '产品部', labelEn: 'PROD', x: 32, y: 32, width: 384, height: 256, floorColor: 0x3a2a5c },
        { id: 'z-dev', type: 'department', label: '开发部', labelEn: 'DEV', x: 448, y: 32, width: 384, height: 256, floorColor: 0x2a3a5c },
        { id: 'z-qa', type: 'department', label: '测试部', labelEn: 'QA', x: 864, y: 32, width: 288, height: 256, floorColor: 0x2a4a3a },
      ],
      desks: [
        { id: 'd-1', zoneId: 'z-pm', x: 128, y: 128 },
        { id: 'd-2', zoneId: 'z-pm', x: 288, y: 128 },
        { id: 'd-3', zoneId: 'z-pm', x: 128, y: 224 },
        { id: 'd-4', zoneId: 'z-dev', x: 544, y: 128 },
        { id: 'd-5', zoneId: 'z-dev', x: 704, y: 128 },
        { id: 'd-6', zoneId: 'z-dev', x: 544, y: 224 },
        { id: 'd-7', zoneId: 'z-dev', x: 704, y: 224 },
        { id: 'd-8', zoneId: 'z-qa', x: 960, y: 128 },
        { id: 'd-9', zoneId: 'z-qa', x: 1056, y: 128 },
      ],
      rooms: [
        { id: 'r-mtg', type: 'meeting_room', label: '会议室', x: 32, y: 320, width: 480, height: 192, floorColor: 0x3a4a5c },
        { id: 'r-srv', type: 'server_room', label: '服务器间', x: 544, y: 320, width: 192, height: 192, floorColor: 0x3a2a2a },
        { id: 'r-rest', type: 'rest_area', label: '休息区', x: 768, y: 320, width: 384, height: 192, floorColor: 0x4a4a3a },
      ],
    };
  }

  // ── Rendering ──

  private renderAll(): void {
    this.renderZones();
    this.renderDesks();
    this.renderRooms();
    // Re-draw selection handles on top
    if (this.selectionHandler) {
      this.selectionHandler.select(
        this.selectionHandler.selection,
        this.zones,
        this.desks,
        this.rooms,
      );
    }
  }

  private renderZones(): void {
    if (!this.zoneLayer) return;
    // Clear
    while (this.zoneLayer.children.length > 0) {
      const child = this.zoneLayer.children[0]!;
      this.zoneLayer.removeChild(child);
      child.destroy({ children: true });
    }

    for (const zone of this.zones) {
      const g = new Graphics();
      ZoneTool.drawZone(g, zone);
      this.zoneLayer.addChild(g);

      // Label
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
      label.alpha = 0.5;
      label.position.set(zone.x + 8, zone.y + 6);
      this.zoneLayer.addChild(label);

      const subLabel = new Text({
        text: zone.label,
        style: {
          fontSize: 8,
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
        },
      });
      subLabel.alpha = 0.3;
      subLabel.position.set(zone.x + 8, zone.y + 20);
      this.zoneLayer.addChild(subLabel);
    }
  }

  private renderDesks(): void {
    if (!this.deskLayer) return;
    while (this.deskLayer.children.length > 0) {
      const child = this.deskLayer.children[0]!;
      this.deskLayer.removeChild(child);
      child.destroy({ children: true });
    }

    const g = new Graphics();
    for (const desk of this.desks) {
      DeskTool.drawDesk(g, desk);
    }
    this.deskLayer.addChild(g);
  }

  private renderRooms(): void {
    if (!this.roomLayer) return;
    while (this.roomLayer.children.length > 0) {
      const child = this.roomLayer.children[0]!;
      this.roomLayer.removeChild(child);
      child.destroy({ children: true });
    }

    for (const room of this.rooms) {
      const g = new Graphics();
      RoomTool.drawRoom(g, room);
      this.roomLayer.addChild(g);

      // Label
      const label = new Text({
        text: ROOM_LABELS_MAP[room.type] ?? room.label,
        style: {
          fontSize: 10,
          fill: 0xffffff,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 'bold',
        },
      });
      label.alpha = 0.5;
      label.position.set(room.x + 8, room.y + 6);
      this.roomLayer.addChild(label);
    }
  }

  private drawEditorTint(): void {
    if (!this.backgroundLayer) return;
    const tint = new Graphics();
    tint.rect(0, 0, this.canvasWidth, this.canvasHeight);
    tint.fill({ color: 0x3b82f6, alpha: EDITOR_TINT_ALPHA });
    this.backgroundLayer.addChildAt(tint, 0);
  }

  // ── Pointer Events ──

  private attachPointerEvents(app: Application): void {
    const canvas = app.canvas as HTMLCanvasElement;

    const onPointerDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.handlePointerDown(x, y);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.handlePointerMove(x, y);
    };

    const onPointerUp = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.handlePointerUp(x, y);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.zoneTool?.cancelDraw();
        this.dragState = null;
        this.deselectAll();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        this.deleteSelected();
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    globalThis.addEventListener('keydown', onKeyDown);

    this.unsubscribers.push(
      () => canvas.removeEventListener('pointerdown', onPointerDown),
      () => canvas.removeEventListener('pointermove', onPointerMove),
      () => canvas.removeEventListener('pointerup', onPointerUp),
      () => globalThis.removeEventListener('keydown', onKeyDown),
    );
  }

  private handlePointerDown(x: number, y: number): void {
    switch (this._tool) {
      case 'select':
        this.handleSelectDown(x, y);
        break;
      case 'draw-zone':
        this.zoneTool?.startDraw(x, y);
        break;
      case 'place-desk': {
        const desk = DeskTool.placeDesk(x, y, this.zones);
        if (desk) this.addDesk(desk);
        break;
      }
      case 'place-room': {
        const room = this.roomTool.placeRoom(x, y);
        this.addRoom(room);
        break;
      }
    }
  }

  private handlePointerMove(x: number, y: number): void {
    if (this._tool === 'draw-zone') {
      this.zoneTool?.updateDraw(x, y);
      return;
    }

    if (this.dragState) {
      this.handleDragMove(x, y);
    }
  }

  private handlePointerUp(x: number, y: number): void {
    if (this._tool === 'draw-zone' && this.zoneTool?.isDrawing) {
      const zone = this.zoneTool.finishDraw(x, y);
      if (zone) {
        this.addZone(zone);
        this.selectElement({ kind: 'zone', id: zone.id });
      }
      return;
    }

    if (this.dragState) {
      this.dragState = null;
      this.renderAll();
      this.emitStateChange();
    }
  }

  private handleSelectDown(x: number, y: number): void {
    // 1. Check if hit a resize handle
    if (this.selectionHandler) {
      const corner = this.selectionHandler.hitTestHandles(x, y, this.zones, this.desks, this.rooms);
      if (corner) {
        const sel = this.selectionHandler.selection;
        if (sel.kind === 'zone') {
          const zone = this.zones.find((z) => z.id === sel.id);
          if (zone) {
            this.dragState = {
              kind: 'resize',
              id: sel.id,
              startX: x,
              startY: y,
              offsetX: 0,
              offsetY: 0,
              resizeCorner: corner,
              originalBounds: { x: zone.x, y: zone.y, width: zone.width, height: zone.height },
            };
            return;
          }
        } else if (sel.kind === 'room') {
          const room = this.rooms.find((r) => r.id === sel.id);
          if (room) {
            this.dragState = {
              kind: 'resize',
              id: sel.id,
              startX: x,
              startY: y,
              offsetX: 0,
              offsetY: 0,
              resizeCorner: corner,
              originalBounds: { x: room.x, y: room.y, width: room.width, height: room.height },
            };
            return;
          }
        }
      }
    }

    // 2. Hit-test desks (smaller, on top)
    const hitDesk = DeskTool.hitTest(x, y, this.desks);
    if (hitDesk) {
      this.selectElement({ kind: 'desk', id: hitDesk.id });
      this.dragState = {
        kind: 'move-desk',
        id: hitDesk.id,
        startX: hitDesk.x,
        startY: hitDesk.y,
        offsetX: hitDesk.x - x,
        offsetY: hitDesk.y - y,
      };
      return;
    }

    // 3. Hit-test rooms
    const hitRoom = RoomTool.hitTest(x, y, this.rooms);
    if (hitRoom) {
      this.selectElement({ kind: 'room', id: hitRoom.id });
      this.dragState = {
        kind: 'move-room',
        id: hitRoom.id,
        startX: hitRoom.x,
        startY: hitRoom.y,
        offsetX: hitRoom.x - x,
        offsetY: hitRoom.y - y,
      };
      return;
    }

    // 4. Hit-test zones
    const hitZone = DeskTool.findContainingZone(x, y, this.zones);
    if (hitZone) {
      this.selectElement({ kind: 'zone', id: hitZone.id });
      this.dragState = {
        kind: 'move-zone',
        id: hitZone.id,
        startX: hitZone.x,
        startY: hitZone.y,
        offsetX: hitZone.x - x,
        offsetY: hitZone.y - y,
      };
      return;
    }

    // 5. Nothing hit — deselect
    this.deselectAll();
  }

  private handleDragMove(x: number, y: number): void {
    if (!this.dragState) return;

    if (this.dragState.kind === 'resize') {
      this.handleResize(x, y);
      return;
    }

    const snapped = EditorGrid.snapPoint(x + this.dragState.offsetX, y + this.dragState.offsetY);

    switch (this.dragState.kind) {
      case 'move-zone': {
        const zone = this.zones.find((z) => z.id === this.dragState!.id);
        if (zone) {
          // Move desks with zone (compute delta from previous position)
          const dx = snapped.x - this.dragState.startX;
          const dy = snapped.y - this.dragState.startY;
          for (const desk of this.desks) {
            if (desk.zoneId === zone.id) {
              desk.x += dx;
              desk.y += dy;
            }
          }
          zone.x = snapped.x;
          zone.y = snapped.y;
          this.dragState.startX = zone.x;
          this.dragState.startY = zone.y;
        }
        break;
      }
      case 'move-desk': {
        const desk = this.desks.find((d) => d.id === this.dragState!.id);
        if (desk) {
          desk.x = snapped.x;
          desk.y = snapped.y;
          // Re-assign zone if moved
          const containingZone = DeskTool.findContainingZone(desk.x, desk.y, this.zones);
          if (containingZone) {
            desk.zoneId = containingZone.id;
          }
        }
        break;
      }
      case 'move-room': {
        const room = this.rooms.find((r) => r.id === this.dragState!.id);
        if (room) {
          room.x = snapped.x;
          room.y = snapped.y;
        }
        break;
      }
    }

    this.renderAll();
  }

  private handleResize(x: number, y: number): void {
    if (!this.dragState || !this.dragState.originalBounds || !this.dragState.resizeCorner) return;

    const ob = this.dragState.originalBounds;
    const snapped = EditorGrid.snapPoint(x, y);
    const sel = this.selectionHandler?.selection;
    if (!sel || sel.kind === 'none' || sel.kind === 'desk') return;

    let newX = ob.x;
    let newY = ob.y;
    let newW = ob.width;
    let newH = ob.height;

    switch (this.dragState.resizeCorner) {
      case 'se':
        newW = Math.max(GRID_SIZE * 2, snapped.x - ob.x);
        newH = Math.max(GRID_SIZE * 2, snapped.y - ob.y);
        break;
      case 'sw':
        newX = Math.min(snapped.x, ob.x + ob.width - GRID_SIZE * 2);
        newW = ob.x + ob.width - newX;
        newH = Math.max(GRID_SIZE * 2, snapped.y - ob.y);
        break;
      case 'ne':
        newW = Math.max(GRID_SIZE * 2, snapped.x - ob.x);
        newY = Math.min(snapped.y, ob.y + ob.height - GRID_SIZE * 2);
        newH = ob.y + ob.height - newY;
        break;
      case 'nw':
        newX = Math.min(snapped.x, ob.x + ob.width - GRID_SIZE * 2);
        newW = ob.x + ob.width - newX;
        newY = Math.min(snapped.y, ob.y + ob.height - GRID_SIZE * 2);
        newH = ob.y + ob.height - newY;
        break;
    }

    if (sel.kind === 'zone') {
      this.updateZone(sel.id, { x: newX, y: newY, width: newW, height: newH });
    } else if (sel.kind === 'room') {
      this.updateRoom(sel.id, { x: newX, y: newY, width: newW, height: newH });
    }
  }

  private deleteSelected(): void {
    const sel = this.selectionHandler?.selection;
    if (!sel || sel.kind === 'none') return;

    switch (sel.kind) {
      case 'zone': this.removeZone(sel.id); break;
      case 'desk': this.removeDesk(sel.id); break;
      case 'room': this.removeRoom(sel.id); break;
    }
  }

  // ── EventBus Communication ──

  private emitStateChange(): void {
    this.eventBus.emit({
      type: 'editor.state.changed',
      entityId: '',
      entityType: 'employee',
      companyId: '',
      timestamp: Date.now(),
      payload: this.getState(),
    });
  }

  private subscribeEditorEvents(): void {
    // Listen for commands from DOM UI
    const unsub1 = this.eventBus.on('editor.command', (event) => {
      const cmd = event.payload as {
        action: string;
        tool?: EditorTool;
        theme?: OfficeTheme;
        gridVisible?: boolean;
        zoneType?: ZoneType;
        zoneLabelEn?: string;
        roomType?: RoomType;
        templateName?: string;
        template?: OfficeTemplate;
        zoneId?: string;
        deskId?: string;
        roomId?: string;
        patch?: Record<string, unknown>;
      };

      switch (cmd.action) {
        case 'setTool':
          if (cmd.tool) this.setTool(cmd.tool);
          break;
        case 'setTheme':
          if (cmd.theme) this.setTheme(cmd.theme);
          break;
        case 'setGridVisible':
          if (cmd.gridVisible !== undefined) this.setGridVisible(cmd.gridVisible);
          break;
        case 'setZoneType':
          if (this.zoneTool && cmd.zoneType) {
            this.zoneTool.zoneType = cmd.zoneType;
            if (cmd.zoneLabelEn) this.zoneTool.zoneLabelEn = cmd.zoneLabelEn;
          }
          break;
        case 'setRoomType':
          if (cmd.roomType) this.roomTool.roomType = cmd.roomType;
          break;
        case 'exportTemplate':
          if (cmd.templateName) {
            const tmpl = this.exportTemplate(cmd.templateName);
            this.eventBus.emit({
              type: 'editor.template.exported',
              entityId: '',
              entityType: 'employee',
              companyId: '',
              timestamp: Date.now(),
              payload: tmpl,
            });
          }
          break;
        case 'loadTemplate':
          if (cmd.template) this.loadTemplate(cmd.template);
          break;
        case 'updateZone':
          if (cmd.zoneId && cmd.patch) this.updateZone(cmd.zoneId, cmd.patch as Partial<EditorZone>);
          break;
        case 'updateDesk':
          if (cmd.deskId && cmd.patch) this.updateDesk(cmd.deskId, cmd.patch as Partial<EditorDesk>);
          break;
        case 'updateRoom':
          if (cmd.roomId && cmd.patch) this.updateRoom(cmd.roomId, cmd.patch as Partial<EditorRoom>);
          break;
        case 'removeZone':
          if (cmd.zoneId) this.removeZone(cmd.zoneId);
          break;
        case 'removeDesk':
          if (cmd.deskId) this.removeDesk(cmd.deskId);
          break;
        case 'removeRoom':
          if (cmd.roomId) this.removeRoom(cmd.roomId);
          break;
        case 'selectZone':
          if (cmd.zoneId) this.selectElement({ kind: 'zone', id: cmd.zoneId });
          break;
      }
    });

    this.unsubscribers.push(unsub1);
  }
}

/** Room label lookup. */
const ROOM_LABELS_MAP: Record<string, string> = {
  meeting_room: 'MTG',
  library: 'LIB',
  rest_area: 'REST',
  server_room: 'SRV',
};
