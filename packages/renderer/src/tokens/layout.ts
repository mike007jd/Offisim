/** Layout constants for the office scene */
export const LAYOUT = {
  /** Floor dimensions */
  floor: {
    width: 800,
    height: 600,
    padding: 40,
    cornerRadius: 0, // pixel art = sharp corners
  },

  /** Desk grid: 2x2 layout */
  desk: {
    width: 60, // 20 logical px × PX=3
    height: 30, // 10 logical px × PX=3
    gap: 140, // more space for BIG lobsters with raised claws
    cornerRadius: 0, // pixel art
    borderWidth: 0, // no stroke, pixel border is part of tile
  },

  /** Employee avatar (now a big lobster) */
  employee: {
    radius: 48, // positioning offset from desk (big lobster)
    ringWidth: 3, // pixel border width
    fontSize: 10, // slightly smaller for pixel look
    labelOffsetY: 40, // below lobster body
  },

  /** Task bubble */
  taskBubble: {
    maxWidth: 140,
    padding: 8,
    cornerRadius: 0, // pixel art
    fontSize: 10,
    offsetY: -70,
  },

  /** Meeting room (conference table + chairs) */
  meetingRoom: {
    /** Offset from bottom of floor to center of meeting room */
    bottomOffset: 50,
    tableWidth: 120,
    tableHeight: 80,
    tableCornerRadius: 0, // pixel art
    chairRadius: 10,
    /** Horizontal distance from center to side chairs */
    chairSideX: 80,
    /** Horizontal distance from center to top/bottom chairs */
    chairInnerX: 40,
    /** Vertical distance from center to top/bottom chairs */
    chairInnerY: 55,
  },
} as const;
