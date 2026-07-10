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
  ghostValid: string;
  ghostBlocked: string;
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
  windowSky: string;
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

/**
 * P4 operational-state source of truth from the office art bible. These exact
 * values are intentionally separate from generic UI accent/warn/danger tokens:
 * the diorama has a lower-saturation material language. 2D keeps a manually
 * mirrored table in color-palette.ts and the P4 oracle locks equality.
 */
export const OFFICE_TOY_STATE_COLORS = {
  working: '#5C9A96',
  approval: '#D09A45',
  blocked: '#C65F5A',
  selected: '#7FA9D8',
} as const;

export const OFFICE_TOY_SIGNAL_COLORS = {
  artifact: '#1AA46A',
  neutral: '#647186',
} as const;

export const OFFICE_TOY_CHARACTER_COLORS = {
  eye: '#111820',
} as const;

export const LIGHT_SCENE_3D: Scene3DColors = {
  floor: '#cfcabc',
  desk: '#c0a781',
  deskEdge: '#6f6759',
  furniture: '#b9c1c6',
  furnitureDark: '#59656f',
  furnitureLight: '#d7d9d6',
  partition: '#7f96a4',
  screen: '#167f95',
  metal: '#a4adb4',
  serverBody: '#56616d',
  ledCyan: '#3aa6b3',
  ledGreen: '#4c9a72',
  ledBlue: '#4b6e9e',
  ledAmber: '#b7894a',
  potBase: '#9aa19c',
  leafPrimary: '#4b8b68',
  leafSecondary: '#3d705a',
  leafTertiary: '#6ba878',
  text: '#0f172a',
  textMuted: '#4f5a62',
  selectionRing: '#3f6f9e',
  ghostValid: '#37b26c',
  ghostBlocked: '#d6453d',
  sceneBackground: '#e7e3da',
  wallShell: '#dad4c7',
  bookSpine: ['#4b8b68', '#5f7e65', '#7c8e6a', '#6f8f9a', '#8c7b65'],
  cableChannel: '#3f7583',
  vendingScreen: '#a98342',
  tableReading: '#6b8060',
  whiteboardSurface: '#f2f3ef',
  whiteboardMarker: ['#3a8d94', '#59656f', '#a8795f'],
  accentWarm: '#a8795f',
  accentCool: '#3a8d94',
  windowSky: '#cfe3ee',
  floorTile: '#ddd6c8',
  floorTileAlt: '#cec7b6',
  floorGrid: '#b2a996',
  floorBorder: '#9c8b70',
  wallPanel: '#e4dfd4',
  wallTrim: '#a39e92',
  wallShadow: '#a59e90',
  zoneRug: '#dde4df',
  zoneWorkspace: '#c0d3e2',
  zoneMeeting: '#d6cbe0',
  zoneRest: '#d1e0c3',
  zoneLibrary: '#cfdec6',
  zoneServer: '#ded0b6',
  zoneLabelBg: 'rgba(241,243,239,0.9)',
  zoneLabelText: '#24303a',
  labelGlow: '#3a8d94',
  workMat: '#b7cec0',
  cableAccent: '#a8795f',
  characterShoe: '#1e293b',
  characterHand: '#f2c6b6',
  brandNeutral: '#59656f',
  emissiveBase: '#000000',
};

export const SCENE_LIGHTING_COLORS = {
  hemisphereSky: '#fff1dc',
  hemisphereGround: '#cfd7dc',
  key: '#fff3df',
  sideFill: '#a9bbc8',
  rim: '#90a0ad',
  bounceFront: '#f3d1ad',
  bounceBack: '#d5dde2',
} as const;

/** Lightformer emitter colours for the IBL environment rig (SceneEnvironment).
 *  Kept here so the raw scene-art hex values stay in the allowlisted module. */
export const SCENE_ENV_COLORS = {
  ceiling: '#fff0dc',
  sideFill: '#d0dbe0',
  frontBounce: '#f1cfaa',
  backRim: '#e5ebee',
  streak: '#f8f4ec',
} as const;
