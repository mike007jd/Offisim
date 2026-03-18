import { Container, Sprite } from 'pixi.js';
import {
  generateHead,
  generateHair,
  generateEyes,
  generateMouth,
  generateBody,
  generateAccessory,
  type HeadShape,
  type HairStyle,
  type EyeExpression,
  type MouthExpression,
  type ClothingStyle,
  type Accessory,
} from './svg-parts.js';
import { svgToTexture } from './svg-to-texture.js';

// ---------------------------------------------------------------------------
// Character Configuration
// ---------------------------------------------------------------------------

export interface IllustrationCharacterConfig {
  skinColor: string;
  hairColor: string;
  hairStyle: HairStyle;
  headShape: HeadShape;
  clothingColor: string;
  clothingStyle: ClothingStyle;
  accessories: Accessory[];
  scale?: number;
}

export interface AssembledCharacter {
  container: Container;
  /** Swap facial expression without rebuilding the entire character. */
  setExpression(eyes: EyeExpression, mouth: MouthExpression): Promise<void>;
  /** Destroy all textures and sprites. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Default configs per role
// ---------------------------------------------------------------------------

export const ROLE_PRESETS: Record<string, Partial<IllustrationCharacterConfig>> = {
  developer: { clothingStyle: 'hoodie', clothingColor: '#3b4d6b', accessories: ['glasses-round'] },
  designer: { clothingStyle: 'turtleneck', clothingColor: '#1a1a1a', accessories: [] },
  pm: { clothingStyle: 'shirt', clothingColor: '#4a6b8a', accessories: ['badge'] },
  manager: { clothingStyle: 'shirt', clothingColor: '#5a4a6b', accessories: [] },
  writer: { clothingStyle: 'casual', clothingColor: '#6b5a4a', accessories: ['glasses-rect'] },
  analyst: { clothingStyle: 'shirt', clothingColor: '#3a5a5a', accessories: ['glasses-rect'] },
};

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const BODY_Y = 28; // body sprite offset so it appears below the head
const CHAR_SCALE = 0.7; // overall scale to fit typical puppet size (~45px)

export async function assembleCharacter(
  config: IllustrationCharacterConfig,
): Promise<AssembledCharacter> {
  const container = new Container();
  const s = config.scale ?? CHAR_SCALE;

  // Generate SVG strings
  const headSvg = generateHead(config.headShape, config.skinColor);
  const hairSvg = generateHair(config.hairStyle, config.hairColor);
  const bodySvg = generateBody(config.clothingStyle, config.clothingColor);
  const eyesSvg = generateEyes('neutral');
  const mouthSvg = generateMouth('neutral');

  // Convert to textures
  const [headTex, hairTex, bodyTex, eyesTex, mouthTex] = await Promise.all([
    svgToTexture(headSvg),
    svgToTexture(hairSvg),
    svgToTexture(bodySvg),
    svgToTexture(eyesSvg),
    svgToTexture(mouthSvg),
  ]);

  // Assemble sprites — body first (behind), then head layers on top
  const bodySprite = new Sprite(bodyTex);
  bodySprite.anchor.set(0.5, 0);
  bodySprite.y = BODY_Y * s;
  bodySprite.scale.set(s);
  container.addChild(bodySprite);

  const headSprite = new Sprite(headTex);
  headSprite.anchor.set(0.5, 0.5);
  headSprite.y = 14 * s;
  headSprite.scale.set(s);
  container.addChild(headSprite);

  const eyesSprite = new Sprite(eyesTex);
  eyesSprite.anchor.set(0.5, 0.5);
  eyesSprite.y = 14 * s;
  eyesSprite.scale.set(s);
  container.addChild(eyesSprite);

  const mouthSprite = new Sprite(mouthTex);
  mouthSprite.anchor.set(0.5, 0.5);
  mouthSprite.y = 14 * s;
  mouthSprite.scale.set(s);
  container.addChild(mouthSprite);

  const hairSprite = new Sprite(hairTex);
  hairSprite.anchor.set(0.5, 0.5);
  hairSprite.y = 14 * s;
  hairSprite.scale.set(s);
  container.addChild(hairSprite);

  // Accessories on top
  const accSprites: Sprite[] = [];
  for (const acc of config.accessories) {
    const accSvg = generateAccessory(acc);
    const accTex = await svgToTexture(accSvg);
    const accSprite = new Sprite(accTex);
    accSprite.anchor.set(0.5, 0.5);
    accSprite.y = acc === 'badge' ? BODY_Y * s : 14 * s;
    accSprite.scale.set(s);
    container.addChild(accSprite);
    accSprites.push(accSprite);
  }

  // Shadow ellipse under the character
  const { Graphics } = await import('pixi.js');
  const shadowG = new Graphics();
  shadowG.ellipse(0, 0, 16 * s, 4 * s);
  shadowG.fill({ color: 0x000000, alpha: 0.15 });
  shadowG.y = (BODY_Y + 54) * s;
  container.addChildAt(shadowG, 0); // behind everything

  return {
    container,

    async setExpression(eyes: EyeExpression, mouth: MouthExpression) {
      const [newEyesTex, newMouthTex] = await Promise.all([
        svgToTexture(generateEyes(eyes)),
        svgToTexture(generateMouth(mouth)),
      ]);
      eyesSprite.texture = newEyesTex;
      mouthSprite.texture = newMouthTex;
    },

    destroy() {
      container.destroy({ children: true });
    },
  };
}
