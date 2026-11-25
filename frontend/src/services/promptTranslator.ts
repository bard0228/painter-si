import { getSavedGeminiApiKey } from './geminiStoryboardService';

const HAS_CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export function containsChinese(text: string): boolean {
  return HAS_CJK_RE.test(text);
}

/**
 * Automatically translate Chinese prompt to English for SDXL / ComfyUI.
 * 1. If Gemini API Key is saved, uses Gemini 2.5 Flash for high-quality visual prompt translation.
 * 2. Otherwise falls back to free MyMemory translation API (no key required).
 */
export async function translatePromptToEnglish(rawPrompt: string): Promise<{
  englishPrompt: string;
  translated: boolean;
}> {
  const trimmed = rawPrompt.trim();
  if (!trimmed || !containsChinese(trimmed)) {
    return { englishPrompt: trimmed, translated: false };
  }

  const geminiKey = getSavedGeminiApiKey().trim();
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Translate the following Chinese image description into a concise, vivid English prompt for Stable Diffusion / SDXL. Output ONLY the English prompt, no quotes or explanation:\n\n${trimmed}`,
                },
              ],
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (out) {
          return { englishPrompt: out, translated: true };
        }
      }
    } catch {
      // Fallback to free translator below
    }
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=zh-TW|en`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const translatedText = data?.responseData?.translatedText?.trim();
      if (translatedText) {
        return { englishPrompt: translatedText, translated: true };
      }
    }
  } catch {
    // Keep original if offline
  }

  return { englishPrompt: trimmed, translated: false };
}
