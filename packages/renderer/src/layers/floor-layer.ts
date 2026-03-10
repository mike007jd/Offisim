import { Container, Graphics } from 'pixi.js';
import { SCENE_COLORS } from '../tokens/colors.js';
import { LAYOUT } from '../tokens/layout.js';

export interface DeskPosition {
  x: number;
  y: number;
}

export class FloorLayer {
  readonly container: Container;

  constructor() {
    this.container = new Container();
    this.drawFloor();
    this.drawDesks();
  }

  /** Get desk center positions for placing employees */
  getDeskPositions(): DeskPosition[] {
    const { floor, desk } = LAYOUT;
    const startX = (floor.width - (2 * desk.width + desk.gap)) / 2 + desk.width / 2;
    const startY = (floor.height - (2 * desk.height + desk.gap)) / 2 + desk.height / 2;

    return [
      { x: startX, y: startY },
      { x: startX + desk.width + desk.gap, y: startY },
      { x: startX, y: startY + desk.height + desk.gap },
      { x: startX + desk.width + desk.gap, y: startY + desk.height + desk.gap },
    ];
  }

  private drawFloor(): void {
    const { width, height, cornerRadius } = LAYOUT.floor;
    const g = new Graphics();
    g.roundRect(0, 0, width, height, cornerRadius);
    g.fill(SCENE_COLORS.floor);
    g.stroke({ width: 1, color: SCENE_COLORS.floorBorder });
    this.container.addChild(g);
  }

  private drawDesks(): void {
    const positions = this.getDeskPositions();
    const { width, height, cornerRadius, borderWidth } = LAYOUT.desk;

    for (const pos of positions) {
      const g = new Graphics();
      g.roundRect(pos.x - width / 2, pos.y - height / 2, width, height, cornerRadius);
      g.fill(SCENE_COLORS.desk);
      g.stroke({ width: borderWidth, color: SCENE_COLORS.deskBorder });
      this.container.addChild(g);
    }
  }
}
