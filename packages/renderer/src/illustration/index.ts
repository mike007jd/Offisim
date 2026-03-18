export {
  type HeadShape,
  type HairStyle,
  type EyeExpression,
  type MouthExpression,
  type ClothingStyle,
  type Accessory,
  generateHead,
  generateHair,
  generateEyes,
  generateMouth,
  generateBody,
  generateAccessory,
} from './svg-parts.js';

export { svgToTexture, clearTextureCache } from './svg-to-texture.js';

export {
  type IllustrationCharacterConfig,
  type AssembledCharacter,
  ROLE_PRESETS,
  assembleCharacter,
} from './character-assembler.js';
