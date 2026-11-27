import type { StylePreset } from '../types/domain';

export const ANIME_CHECKPOINT = 'animagine-xl-3.1.safetensors';
export const REALISTIC_CHECKPOINT = 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors';

export function nowTaipeiIso(): string {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().replace('Z', '+08:00');
}

export const DEFAULT_STYLE_PRESETS: Omit<StylePreset, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'preset-img-washi-collage',
    name: '日系和紙幾何拼貼',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, Japanese minimalist editorial illustration, flat geometric paper-cut collage style, clean angular faceted polygon planes, overlapping translucent matte gouache shapes, no black outlines, soft muted Morandi earth palette with warm off-white washi paper background, dusty sage green, muted slate blue and warm ochre, gentle diffused natural daylight, serene quiet atmosphere, subtle fine cotton paper grain texture, generous negative space',
    negativePromptTemplate:
      'photorealistic, photograph, 3d render, glossy, shiny, black outlines, thick ink lines, harsh contrast, neon colors, oversaturated, text, typography, watermark, signature, messy brushstrokes, anime shading',
    sampler: 'euler_ancestral',
    steps: 26,
    cfgScale: 6.5,
    checkpointName: ANIME_CHECKPOINT,
    loraName: '',
  },
  {
    id: 'preset-img-lora-luminous-anime',
    name: '光影動漫',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, masterpiece, best quality, very aesthetic, ethereal anime illustration, breathtaking dramatic lighting, volumetric god rays, glowing rim light, luminous atmospheric depth, delicate anime character, shimmering particles',
    negativePromptTemplate:
      'nsfw, lowres, bad anatomy, bad hands, extra fingers, text, error, missing fingers, worst quality, low quality, photorealistic, 3d render, flat lighting, watermark',
    sampler: 'euler_ancestral',
    steps: 28,
    cfgScale: 6.5,
    checkpointName: ANIME_CHECKPOINT,
    loraName: '光影動漫.safetensors',
  },
  {
    id: 'preset-img-lora-cosmic-anime',
    name: '唯美宇宙',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, masterpiece, best quality, very aesthetic, ethereal anime art, vast cosmic night sky, glowing full moon, sparkling starry nebula, infinite tranquil space atmosphere, dreamy celestial light, delicate anime character, cinematic wide composition',
    negativePromptTemplate:
      'nsfw, lowres, bad anatomy, bad hands, worst quality, low quality, photorealistic, 3d render, cluttered background, harsh daytime, watermark, text',
    sampler: 'euler_ancestral',
    steps: 28,
    cfgScale: 6.5,
    checkpointName: ANIME_CHECKPOINT,
    loraName: '唯美宇宙.safetensors',
  },
  {
    id: 'preset-img-lora-realistic',
    name: '寫實風',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, ultra-realistic photography, natural authentic lighting, lifelike textures, crisp fine details, natural color grading, shallow depth of field, DSLR 50mm lens, photorealistic masterpiece',
    negativePromptTemplate:
      'anime, cartoon, illustration, painting, 3d cgi, plastic skin, oversaturated, lowres, blurry, deformed, watermark, text',
    sampler: 'dpmpp_2m',
    steps: 28,
    cfgScale: 5.5,
    checkpointName: REALISTIC_CHECKPOINT,
    loraName: '寫實風.safetensors',
  },
  {
    id: 'preset-img-lora-game-anime',
    name: '遊戲動漫',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, masterpiece, best quality, very aesthetic, high-budget JRPG game CG illustration, vibrant anime character art, dynamic polished shading, crisp cel-shaded details, rich fantasy game environment, official game key visual quality',
    negativePromptTemplate:
      'nsfw, lowres, bad anatomy, bad hands, worst quality, low quality, photorealistic, photograph, dull colors, sketch, rough lines, watermark, UI HUD text',
    sampler: 'euler_ancestral',
    steps: 28,
    cfgScale: 6.5,
    checkpointName: ANIME_CHECKPOINT,
    loraName: '遊戲動漫.safetensors',
  },
  {
    id: 'preset-img-watercolor',
    name: '日系繪本水彩',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, masterpiece, best quality, soft watercolor illustration, warm pastel palette, textured cotton paper, gentle sunlight, hand-painted storybook style, delicate ink outlines',
    negativePromptTemplate:
      'photorealistic, 3d render, harsh contrast, neon colors, blurry, watermark, text, deformed anatomy',
    sampler: 'euler_ancestral',
    steps: 26,
    cfgScale: 6.5,
    checkpointName: ANIME_CHECKPOINT,
    loraName: '',
  },
  {
    id: 'preset-img-cinematic',
    name: '電影感底片寫實',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, 35mm film photography, Kodak Portra 400, shallow depth of field, natural rim lighting, subtle film grain, cinematic composition, photorealistic',
    negativePromptTemplate:
      'anime, cartoon, cgi, oversaturated, plastic skin, lowres, jpeg artifacts, watermark',
    sampler: 'dpmpp_2m',
    steps: 28,
    cfgScale: 5.5,
    checkpointName: REALISTIC_CHECKPOINT,
    loraName: '',
  },
  {
    id: 'preset-vid-breeze',
    name: '微風電影推鏡',
    type: 'video',
    positivePromptTemplate:
      '{prompt}, slow smooth camera push-in, gentle breeze, natural motion, consistent lighting, cinematic 24fps film look',
    negativePromptTemplate:
      'flickering, rapid camera shake, morphing, distorted faces, static freeze, compression artifacts',
    sampler: 'euler',
    steps: 20,
    cfgScale: 6.0,
    loraName: '',
  },
];
