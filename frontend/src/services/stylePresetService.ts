import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../config/firebase';
import { DEFAULT_STYLE_PRESETS, nowTaipeiIso } from '../data/defaultStylePresets';
import type { StylePreset } from '../types/domain';

const LOCAL_STORAGE_KEY = 'huishi_style_presets_local_v1';

export type StylePresetInput = Omit<StylePreset, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  createdAt?: string;
};

function readLocalPresets(): StylePreset[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StylePreset[]) : [];
  } catch {
    return [];
  }
}

function writeLocalPresets(items: StylePreset[]): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export function createSeededPresets(): StylePreset[] {
  const ts = nowTaipeiIso();
  return DEFAULT_STYLE_PRESETS.map((p) => ({
    ...p,
    createdAt: ts,
    updatedAt: ts,
  }));
}

export function subscribeStylePresets(
  useCloud: boolean,
  onData: (presets: StylePreset[]) => void,
  onError: (err: Error) => void
): () => void {
  if (!useCloud || !db || !isFirebaseConfigured) {
    const existing = readLocalPresets();
    if (existing.length === 0) {
      const seeded = createSeededPresets();
      writeLocalPresets(seeded);
      onData(seeded);
    } else {
      onData(existing);
    }
    return () => {};
  }

  const q = query(collection(db, 'stylePresets'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: StylePreset[] = [];
      snap.forEach((d) => list.push(d.data() as StylePreset));
      onData(list);
    },
    (err) => onError(err)
  );
}

export async function saveStylePreset(
  useCloud: boolean,
  input: StylePresetInput
): Promise<StylePreset> {
  const ts = nowTaipeiIso();
  const id =
    input.id ||
    `preset-${input.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const record: StylePreset = {
    id,
    name: input.name.trim(),
    type: input.type,
    positivePromptTemplate: input.positivePromptTemplate.trim(),
    negativePromptTemplate: input.negativePromptTemplate.trim(),
    sampler: input.sampler.trim() || 'euler',
    steps: Number(input.steps) || 24,
    cfgScale: Number(input.cfgScale) || 6.5,
    loraName: (input.loraName || '').trim(),
    createdAt: input.createdAt || ts,
    updatedAt: ts,
  };

  if (useCloud && db && isFirebaseConfigured) {
    await setDoc(doc(db, 'stylePresets', id), record, { merge: true });
    return record;
  }

  const list = readLocalPresets();
  const idx = list.findIndex((item) => item.id === id);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.unshift(record);
  }
  writeLocalPresets(list);
  return record;
}

export async function deleteStylePreset(useCloud: boolean, id: string): Promise<void> {
  if (useCloud && db && isFirebaseConfigured) {
    await deleteDoc(doc(db, 'stylePresets', id));
    return;
  }
  const list = readLocalPresets().filter((item) => item.id !== id);
  writeLocalPresets(list);
}

export async function seedDefaultStylePresets(
  useCloud: boolean,
  existingIds: Set<string>
): Promise<StylePreset[]> {
  const ts = nowTaipeiIso();
  const toInsert = DEFAULT_STYLE_PRESETS.filter((p) => !existingIds.has(p.id)).map((p) => ({
    ...p,
    createdAt: ts,
    updatedAt: ts,
  }));

  if (toInsert.length === 0) return [];

  if (useCloud && db && isFirebaseConfigured) {
    const firestore = db;
    await Promise.all(
      toInsert.map((preset) =>
        setDoc(doc(firestore, 'stylePresets', preset.id), preset, { merge: true })
      )
    );
    return toInsert;
  }

  const list = readLocalPresets();
  const merged = [...toInsert, ...list];
  writeLocalPresets(merged);
  return toInsert;
}
