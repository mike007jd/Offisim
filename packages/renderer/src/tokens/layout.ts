/** Layout constants for the office scene */
export const LAYOUT = {
  /** Floor dimensions */
  floor: {
    width: 800,
    height: 500,
    padding: 40,
    cornerRadius: 0, // pixel art = sharp corners
  },

  /** Desk grid: 2x2 layout */
  desk: {
    width: 60, // 20 logical px × PX=3
    height: 30, // 10 logical px × PX=3
    gap: 80, // more space for lobsters
    cornerRadius: 0, // pixel art
    borderWidth: 0, // no stroke, pixel border is part of tile
  },

  /** Employee avatar (now a lobster) */
  employee: {
    radius: 24, // kept for positioning compatibility
    ringWidth: 3, // pixel border width
    fontSize: 10, // slightly smaller for pixel look
    labelOffsetY: 30, // adjusted for lobster size
  },

  /** Task bubble */
  taskBubble: {
    maxWidth: 140,
    padding: 8,
    cornerRadius: 0, // pixel art
    fontSize: 10,
    offsetY: -44,
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
