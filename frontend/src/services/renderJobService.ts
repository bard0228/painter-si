import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, isFirebaseConfigured } from '../config/firebase';
import { nowTaipeiIso } from '../data/defaultStylePresets';
import type { RenderJob, Storyboard, StylePreset } from '../types/domain';

const LOCAL_JOBS_KEY = 'huishi_render_jobs_local_v1';

function readLocalJobs(): RenderJob[] {
  try {
    const raw = localStorage.getItem(LOCAL_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RenderJob[]) : [];
  } catch {
    return [];
  }
}

function writeLocalJobs(jobs: RenderJob[]): void {
  try {
    localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(jobs.slice(0, 20)));
  } catch {
    // Ignore storage quota errors
  }
}

export function subscribeRenderJobs(
  useCloud: boolean,
  onData: (jobs: RenderJob[]) => void,
  onError: (err: Error) => void
): () => void {
  if (!useCloud || !db || !isFirebaseConfigured) {
    onData(readLocalJobs());
    return () => {};
  }

  const q = query(collection(db, 'renderJobs'), orderBy('updatedAt', 'desc'), limit(20));
  return onSnapshot(
    q,
    (snap) => {
      const list: RenderJob[] = [];
      snap.forEach((d) => list.push(d.data() as RenderJob));
      onData(list);
    },
    (err) => onError(err)
  );
}

export async function submitSingleImageRenderJob(params: {
  useCloud: boolean;
  gatewayUrl?: string;
  user: User | null;
  prompt: string;
  stylePreset: StylePreset;
  aspectRatio?: string;
  orientation?: 'portrait' | 'landscape';
}): Promise<RenderJob> {
  const {
    useCloud,
    gatewayUrl,
    user,
    prompt,
    stylePreset,
    aspectRatio = '1:1',
    orientation = 'portrait',
  } = params;
  const ts = nowTaipeiIso();
  const jobId = `job-img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const job: RenderJob = {
    id: jobId,
    kind: 'single_image',
    prompt: prompt.trim(),
    stylePresetId: stylePreset.id,
    aspectRatio,
    orientation,
    status: 'queued',
    progress: 5,
    createdAt: ts,
    updatedAt: ts,
  };

  if (!useCloud || !db || !user || !gatewayUrl) {
    const list = [job, ...readLocalJobs()];
    writeLocalJobs(list);
    return job;
  }

  await setDoc(doc(db, 'renderJobs', jobId), job, { merge: true });

  const idToken = await user.getIdToken(true);
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/render/image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      prompt: prompt.trim(),
      style_preset: stylePreset,
      aspect_ratio: aspectRatio,
      orientation,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const failed: RenderJob = {
      ...job,
      status: 'failed',
      progress: 0,
      errorMessage: `HTTP ${res.status}: ${detail || res.statusText}`,
      updatedAt: nowTaipeiIso(),
    };
    await setDoc(doc(db, 'renderJobs', jobId), failed, { merge: true });
    throw new Error(failed.errorMessage);
  }

  return job;
}

export async function submitImageEditJob(params: {
  useCloud: boolean;
  gatewayUrl?: string;
  user: User | null;
  sourceJob: RenderJob;
  prompt: string;
  stylePreset: StylePreset;
  denoise: number;
  maskBase64?: string | null;
}): Promise<RenderJob> {
  const { useCloud, gatewayUrl, user, sourceJob, prompt, stylePreset, denoise, maskBase64 } = params;
  if (!sourceJob.outputDrivePath) {
    throw new Error('原始圖片尚未完成存檔，無法微調');
  }
  const ts = nowTaipeiIso();
  const jobId = `job-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const job: RenderJob = {
    id: jobId,
    kind: 'single_image',
    sourceJobId: sourceJob.id,
    prompt: prompt.trim(),
    stylePresetId: stylePreset.id,
    aspectRatio: sourceJob.aspectRatio,
    orientation: sourceJob.orientation,
    status: 'queued',
    progress: 5,
    createdAt: ts,
    updatedAt: ts,
  };

  if (!useCloud || !db || !user || !gatewayUrl) {
    const list = [job, ...readLocalJobs()];
    writeLocalJobs(list);
    return job;
  }

  await setDoc(doc(db, 'renderJobs', jobId), job, { merge: true });

  const idToken = await user.getIdToken(true);
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/render/edit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      source_drive_path: sourceJob.outputDrivePath,
      prompt: prompt.trim(),
      style_preset: stylePreset,
      denoise,
      mask_base64: maskBase64 || null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const failed: RenderJob = {
      ...job,
      status: 'failed',
      progress: 0,
      errorMessage: `HTTP ${res.status}: ${detail || res.statusText}`,
      updatedAt: nowTaipeiIso(),
    };
    await setDoc(doc(db, 'renderJobs', jobId), failed, { merge: true });
    throw new Error(failed.errorMessage);
  }

  return job;
}

export async function submitStoryboardBatchJob(params: {
  useCloud: boolean;
  gatewayUrl?: string;
  user: User | null;
  storyboard: Storyboard;
  presets: StylePreset[];
  rerollShotId?: string;
}): Promise<RenderJob> {
  const { useCloud, gatewayUrl, user, storyboard, presets, rerollShotId } = params;
  const ts = nowTaipeiIso();
  const jobId = `job-sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const job: RenderJob = {
    id: jobId,
    kind: 'storyboard_batch',
    storyboardId: storyboard.id,
    status: 'queued',
    progress: 0,
    createdAt: ts,
    updatedAt: ts,
  };

  if (!useCloud || !db || !user || !gatewayUrl) {
    const list = [job, ...readLocalJobs()];
    writeLocalJobs(list);
    return job;
  }

  await setDoc(doc(db, 'renderJobs', jobId), job, { merge: true });

  const presetsMap: Record<string, StylePreset> = {};
  for (const p of presets) {
    presetsMap[p.id] = p;
  }

  const idToken = await user.getIdToken(true);
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/render/storyboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      storyboard_id: storyboard.id,
      storyboard,
      style_presets_map: presetsMap,
      reroll_shot_id: rerollShotId || null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const failed: RenderJob = {
      ...job,
      status: 'failed',
      progress: 0,
      errorMessage: `HTTP ${res.status}: ${detail || res.statusText}`,
      updatedAt: nowTaipeiIso(),
    };
    await setDoc(doc(db, 'renderJobs', jobId), failed, { merge: true });
    throw new Error(failed.errorMessage);
  }

  return job;
}

export function buildMediaUrl(gatewayUrl: string, mediaPath: string, idToken: string): string {
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const cleanPath = mediaPath.replace(/^\/+/, '');
  return `${cleanUrl}/media/${cleanPath}?token=${encodeURIComponent(idToken)}`;
}

export async function fetchBgmFiles(gatewayUrl: string, user: User): Promise<string[]> {
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const idToken = await user.getIdToken(true);
  const res = await fetch(`${cleanUrl}/bgm`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    throw new Error(`讀取 BGM 失敗 (${res.status})`);
  }
  const data = (await res.json()) as { files?: string[] };
  return Array.isArray(data.files) ? data.files : [];
}

export async function submitFfmpegExportJob(params: {
  useCloud: boolean;
  gatewayUrl?: string;
  user: User | null;
  storyboard: Storyboard;
  bgmFilename?: string;
  burnSubtitles: boolean;
}): Promise<RenderJob> {
  const { useCloud, gatewayUrl, user, storyboard, bgmFilename, burnSubtitles } = params;
  const ts = nowTaipeiIso();
  const jobId = `job-exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const job: RenderJob = {
    id: jobId,
    kind: 'ffmpeg_export',
    storyboardId: storyboard.id,
    status: 'queued',
    progress: 5,
    createdAt: ts,
    updatedAt: ts,
  };

  if (!useCloud || !db || !user || !gatewayUrl) {
    const list = [job, ...readLocalJobs()];
    writeLocalJobs(list);
    return job;
  }

  await setDoc(doc(db, 'renderJobs', jobId), job, { merge: true });

  const idToken = await user.getIdToken(true);
  const cleanUrl = gatewayUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/render/export`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      storyboard_id: storyboard.id,
      shots: storyboard.shots,
      bgm_filename: bgmFilename || null,
      burn_subtitles: burnSubtitles,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const failed: RenderJob = {
      ...job,
      status: 'failed',
      progress: 0,
      errorMessage: `HTTP ${res.status}: ${detail || res.statusText}`,
      updatedAt: nowTaipeiIso(),
    };
    await setDoc(doc(db, 'renderJobs', jobId), failed, { merge: true });
    throw new Error(failed.errorMessage);
  }

  return job;
}

export async function deleteRenderJob(useCloud: boolean, jobId: string): Promise<void> {
  if (useCloud && db && isFirebaseConfigured) {
    await deleteDoc(doc(db, 'renderJobs', jobId));
    return;
  }
  const list = readLocalJobs().filter((j) => j.id !== jobId);
  writeLocalJobs(list);
}
