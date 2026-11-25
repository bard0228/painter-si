import type { StylePreset } from '../types/domain';

export function nowTaipeiIso(): string {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().replace('Z', '+08:00');
}

export const DEFAULT_STYLE_PRESETS: Omit<StylePreset, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'preset-img-watercolor',
    name: '日系繪本水彩',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, soft watercolor illustration, warm pastel palette, textured cotton paper, gentle sunlight, hand-painted storybook style, delicate ink outlines',
    negativePromptTemplate:
      'photorealistic, 3d render, harsh contrast, neon colors, blurry, watermark, text, deformed anatomy',
    sampler: 'euler_ancestral',
    steps: 24,
    cfgScale: 6.5,
    loraName: '',
  },
  {
    id: 'preset-img-cinematic',
    name: '電影感底片寫實',
    type: 'image',
    positivePromptTemplate:
      '{prompt}, 35mm film photography, Kodak Portra 400, shallow depth of field, natural rim lighting, subtle film grain, cinematic composition',
    negativePromptTemplate:
      'anime, cartoon, cgi, oversaturated, plastic skin, lowres, jpeg artifacts, watermark',
    sampler: 'dpmpp_2m',
    steps: 28,
    cfgScale: 5.5,
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
