// ── Room Tool ───────────────────────────────────────────────────────
// Places special rooms (meeting, library, break, server) in the editor.

import { Graphics } from 'pixi.js';
import type { EditorRoom, RoomType } from './types.js';
import { ZONE_TYPE_COLORS } from './types.js';
import { EditorGrid } from './editor-grid.js';

/** Default room dimensions. */
const DEFAULT_ROOM_SIZES: Record<RoomType, { width: number; height: number }> = {
  meeting_room: { width: 256, height: 160 },
  library: { width: 224, height: 160 },
  rest_area: { width: 224, height: 128 },
  server_room: { width: 160, height: 128 },
};

/** Room display labels. */
const ROOM_LABELS: Record<RoomType, { label: string; labelEn: string }> = {
  meeting_room: { label: '会议室', labelEn: 'MTG' },
  library: { label: '图书馆', labelEn: 'LIB' },
  rest_area: { label: '休息区', labelEn: 'REST' },
  server_room: { label: '服务器间', labelEn: 'SRV' },
};

export class RoomTool {
  /** The room type to place next. */
  roomType: RoomType = 'meeting_room';

  /** Place a room at the given position. */
  placeRoom(x: number, y: number): EditorRoom {
    const snapped = EditorGrid.snapPoint(x, y);
    const size = DEFAULT_ROOM_SIZES[this.roomType];
    const labels = ROOM_LABELS[this.roomType];
    const color = (ZONE_TYPE_COLORS as Record<string, number>)[this.roomType] ?? 0x3a4a5c;

    return {
      id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: this.roomType,
      label: labels.label,
      x: snapped.x,
      y: snapped.y,
      width: size.width,
      height: size.height,
      floorColor: color,
    };
  }

  /** Draw a room onto a Graphics object. */
  static drawRoom(g: Graphics, room: EditorRoom): void {
    // Fill with rounded rect
    g.roundRect(room.x, room.y, room.width, room.height, 6);
    g.fill(room.floorColor);

    // Border
    g.roundRect(room.x, room.y, room.width, room.height, 6);
    g.stroke({ color: 0xffffff, alpha: 0.12, width: 1 });

    // Room type icon indicator (simple geometric shape at center)
    const cx = room.x + room.width / 2;
    const cy = room.y + room.height / 2;

    switch (room.type) {
      case 'meeting_room':
        // Conference table shape
        g.roundRect(cx - 30, cy - 15, 60, 30, 6);
        g.fill({ color: 0x4a3728, alpha: 0.8 });
        break;
      case 'library':
        // Book stack
        g.rect(cx - 12, cy - 15, 24, 30);
        g.fill({ color: 0x8b6914, alpha: 0.8 });
        break;
      case 'rest_area':
        // Sofa shape
        g.roundRect(cx - 20, cy - 8, 40, 16, 4);
        g.fill({ color: 0x6b21a8, alpha: 0.8 });
        break;
      case 'server_room':
        // Rack shape
        g.rect(cx - 10, cy - 18, 20, 36);
        g.fill({ color: 0x374151, alpha: 0.8 });
        // Indicator lights
        g.circle(cx - 4, cy - 10, 2);
        g.fill({ color: 0x4ade80, alpha: 0.8 });
        g.circle(cx + 4, cy - 10, 2);
        g.fill({ color: 0x4ade80, alpha: 0.8 });
        break;
    }
  }

  /** Hit-test for rooms. */
  static hitTest(x: number, y: number, rooms: EditorRoom[]): EditorRoom | null {
    for (const room of rooms) {
      if (
        x >= room.x && x <= room.x + room.width &&
        y >= room.y && y <= room.y + room.height
      ) {
        return room;
      }
    }
    return null;
  }
}

export { DEFAULT_ROOM_SIZES, ROOM_LABELS };
