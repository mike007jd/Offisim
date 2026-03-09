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
} as const;
