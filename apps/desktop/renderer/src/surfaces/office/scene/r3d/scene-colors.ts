/**
 * 3D scene colour palette, ported from the legacy `colors-3d` token module.
 * The desktop renderer is light-only, so only the LIGHT palette is kept. These
 * are art-direction values for the WebGL diorama (WebGL materials can't read CSS
 * vars), not UI chrome — UI chrome stays on `--off-*` tokens.
 */

export interface Scene3DColors {
  floor: string;
  desk: string;
  deskEdge: string;
  furniture: string;
  furnitureDark: string;
  furnitureLight: string;
  partition: string;
  screen: string;
  metal: string;
  serverBody: string;
  ledCyan: string;
  ledGreen: string;
  ledBlue: string;
  ledAmber: string;
  potBase: string;
  leafPrimary: string;
  leafSecondary: string;
  leafTertiary: string;
  text: string;
  textMuted: string;
  selectionRing: string;
  sceneBackground: string;
  wallShell: string;
  bookSpine: readonly [string, string, string, string, string];
  cableChannel: string;
  vendingScreen: string;
  tableReading: string;
  whiteboardSurface: string;
  whiteboardMarker: readonly [string, string, string];
  accentWarm: string;
  accentCool: string;
  floorTile: string;
  floorTileAlt: string;
  floorGrid: string;
  floorBorder: string;
  wallPanel: string;
  wallTrim: string;
  wallShadow: string;
  zoneRug: string;
  zoneWorkspace: string;
  zoneMeeting: string;
  zoneRest: string;
  zoneLibrary: string;
  zoneServer: string;
  zoneLabelBg: string;
  zoneLabelText: string;
  labelGlow: string;
  workMat: string;
  cableAccent: string;
  characterShoe: string;
  characterHand: string;
  brandNeutral: string;
  emissiveBase: string;
}

export const LIGHT_SCENE_3D: Scene3DColors = {
  floor: '#c4cedb',
  desk: '#aeb9c8',
  deskEdge: '#6b7a8e',
  furniture: '#c1cad6',
  furnitureDark: '#64748b',
  furnitureLight: '#e0e6ef',
  partition: '#475569',
  screen: '#0284c7',
  metal: '#a6b2c2',
  serverBody: '#64748b',
  ledCyan: '#0891b2',
  ledGreen: '#16a34a',
  ledBlue: '#2563eb',
  ledAmber: '#d97706',
  potBase: '#94a3b8',
  leafPrimary: '#059669',
  leafSecondary: '#047857',
  leafTertiary: '#10b981',
  text: '#0f172a',
  textMuted: '#475569',
  selectionRing: '#2563eb',
  sceneBackground: '#e8edf4',
  wallShell: '#aeb9c8',
  bookSpine: ['#059669', '#047857', '#10b981', '#34d399', '#0d9488'],
  cableChannel: '#256d96',
  vendingScreen: '#ca8a04',
  tableReading: '#047857',
  whiteboardSurface: '#ffffff',
  whiteboardMarker: ['#0891b2', '#475569', '#ea580c'],
  accentWarm: '#ea580c',
  accentCool: '#0891b2',
  floorTile: '#d8dee7',
  floorTileAlt: '#cbd5e1',
  floorGrid: '#94a3b8',
  floorBorder: '#9a7b4f',
  wallPanel: '#dbe2ec',
  wallTrim: '#94a3b8',
  wallShadow: '#64748b',
  zoneRug: '#e4ebf3',
  zoneWorkspace: '#cdd9f2',
  zoneMeeting: '#e0d6f4',
  zoneRest: '#d6efe4',
  zoneLibrary: '#d3ecdd',
  zoneServer: '#f2e3cf',
  zoneLabelBg: 'rgba(248,250,252,0.86)',
  zoneLabelText: '#172033',
  labelGlow: '#0891b2',
  workMat: '#b7e4d2',
  cableAccent: '#ea580c',
  characterShoe: '#1e293b',
  characterHand: '#f2c6b6',
  brandNeutral: '#64748b',
  emissiveBase: '#000000',
};

export const SCENE_LIGHTING_COLORS = {
  hemisphereSky: '#ffe9c8',
  hemisphereGround: '#dbe3ef',
  key: '#fffaf0',
  sideFill: '#9bb4d4',
  rim: '#7e90b8',
  bounceFront: '#ffe1bf',
  bounceBack: '#cfd8e8',
} as const;
