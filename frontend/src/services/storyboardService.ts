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
import { nowTaipeiIso } from '../data/defaultStylePresets';
import type { Storyboard } from '../types/domain';

const LOCAL_STORYBOARDS_KEY = 'huishi_storyboards_local_v1';

function readLocalStoryboards(): Storyboard[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORYBOARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Storyboard[]) : [];
  } catch {
    return [];
  }
}

function writeLocalStoryboards(items: Storyboard[]): void {
  try {
    localStorage.setItem(LOCAL_STORYBOARDS_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota errors
  }
}

export function subscribeStoryboards(
  useCloud: boolean,
  onData: (items: Storyboard[]) => void,
  onError: (err: Error) => void
): () => void {
  if (!useCloud || !db || !isFirebaseConfigured) {
    onData(readLocalStoryboards());
    return () => {};
  }

  const q = query(collection(db, 'storyboards'), orderBy('updatedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: Storyboard[] = [];
      snap.forEach((d) => list.push(d.data() as Storyboard));
      onData(list);
    },
    (err) => onError(err)
  );
}

export async function saveStoryboard(
  useCloud: boolean,
  storyboard: Storyboard
): Promise<Storyboard> {
  const ts = nowTaipeiIso();
  const normalized: Storyboard = {
    ...storyboard,
    title: storyboard.title.trim() || '未命名分鏡劇本',
    shots: storyboard.shots.map((shot, idx) => ({
      ...shot,
      order: idx + 1,
    })),
    createdAt: storyboard.createdAt || ts,
    updatedAt: ts,
  };

  if (useCloud && db && isFirebaseConfigured) {
    await setDoc(doc(db, 'storyboards', normalized.id), normalized, { merge: true });
    return normalized;
  }

  const list = readLocalStoryboards();
  const idx = list.findIndex((s) => s.id === normalized.id);
  if (idx >= 0) {
    list[idx] = normalized;
  } else {
    list.unshift(normalized);
  }
  writeLocalStoryboards(list);
  return normalized;
}

export async function deleteStoryboard(useCloud: boolean, id: string): Promise<void> {
  if (useCloud && db && isFirebaseConfigured) {
    await deleteDoc(doc(db, 'storyboards', id));
    return;
  }
  const list = readLocalStoryboards().filter((s) => s.id !== id);
  writeLocalStoryboards(list);
}
