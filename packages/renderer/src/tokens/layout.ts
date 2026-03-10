/** Layout constants for the office scene */
export const LAYOUT = {
  /** Floor dimensions */
  floor: {
    width: 800,
    height: 500,
    padding: 40,
    cornerRadius: 16,
  },

  /** Desk grid: 2x2 layout */
  desk: {
    width: 120,
    height: 80,
    gap: 60,
    cornerRadius: 8,
    borderWidth: 2,
  },

  /** Employee avatar */
  employee: {
    radius: 24,
    ringWidth: 3,
    fontSize: 12,
    labelOffsetY: 34,
  },

  /** Task bubble */
  taskBubble: {
    maxWidth: 140,
    padding: 8,
    cornerRadius: 6,
    fontSize: 10,
    offsetY: -44,
  },

  /** Meeting room (conference table + chairs) */
  meetingRoom: {
    /** Offset from bottom of floor to center of meeting room */
    bottomOffset: 50,
    tableWidth: 120,
    tableHeight: 80,
    tableCornerRadius: 8,
    chairRadius: 10,
    /** Horizontal distance from center to side chairs */
    chairSideX: 80,
    /** Horizontal distance from center to top/bottom chairs */
    chairInnerX: 40,
    /** Vertical distance from center to top/bottom chairs */
    chairInnerY: 55,
  },
} as const;
