import { nowTaipeiIso } from '../data/defaultStylePresets';
import type { Shot, Storyboard } from '../types/domain';

const GEMINI_KEY_STORAGE = 'huishi_gemini_api_key_v1';

export function getSavedGeminiApiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
  } catch {
    return import.meta.env.VITE_GEMINI_API_KEY || '';
  }
}

export function saveGeminiApiKey(key: string): void {
  try {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } catch {
    // Ignore storage quota errors
  }
}

interface GeminiStoryboardResponse {
  title: string;
  shots: Array<{
    visualDescription: string;
    subtitleText: string;
  }>;
}

export async function generateStoryboardWithGemini(params: {
  apiKey: string;
  synopsis: string;
  shotCount: number;
  globalStylePresetId?: string;
}): Promise<Storyboard> {
  const { apiKey, synopsis, shotCount, globalStylePresetId } = params;
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('請先填入 Gemini API Key');
  }
  if (!synopsis.trim()) {
    throw new Error('請先輸入故事大綱');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(cleanKey)}`;

  const systemPrompt = [
    '你是一位專業電影分鏡導演與 AI 影像提示詞設計師。',
    `請將使用者提供的故事大綱，拆解為恰好 ${shotCount} 個連續鏡頭 (Shot)。`,
    '每個鏡頭的 visualDescription 請使用具體、適合 AI 生圖/圖生影的英文畫面描述（含構圖、光影、氛圍與主體動作）。',
    '每個鏡頭的 subtitleText 請使用簡潔自然的繁體中文字幕（每鏡約 6~18 字）。',
  ].join('\n');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n故事大綱：\n${synopsis.trim()}` }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          shots: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                visualDescription: { type: 'STRING' },
                subtitleText: { type: 'STRING' },
              },
              required: ['visualDescription', 'subtitleText'],
            },
          },
        },
        required: ['title', 'shots'],
      },
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API 錯誤 (${res.status}): ${errText || res.statusText}`);
  }

  const json = await res.json();
  const rawText: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API 未回傳有效分鏡內容');
  }

  const parsed = JSON.parse(rawText) as GeminiStoryboardResponse;
  const ts = nowTaipeiIso();
  const sbId = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const shots: Shot[] = (parsed.shots || []).map((s, idx) => ({
    id: `shot-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    order: idx + 1,
    visualDescription: s.visualDescription || '',
    subtitleText: s.subtitleText || '',
    imageStylePresetId: globalStylePresetId || undefined,
    trimStartSec: 0,
    trimEndSec: 4,
    status: 'pending',
  }));

  return {
    id: sbId,
    title: (parsed.title || '未命名分鏡劇本').trim(),
    synopsis: synopsis.trim(),
    globalStylePresetId: globalStylePresetId || undefined,
    shots,
    createdAt: ts,
    updatedAt: ts,
  };
}
