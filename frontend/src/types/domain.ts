/**
 * 領域詞彙表 (Glossary) 嚴格型別定義
 * 禁止混用同義詞：StylePreset, Storyboard, Shot, RenderJob, BackendGateway
 */

export type StylePresetType = 'image' | 'video';

export interface StylePreset {
  id: string;
  name: string;
  type: StylePresetType;
  positivePromptTemplate: string;
  negativePromptTemplate: string;
  sampler: string;
  steps: number;
  cfgScale: number;
  checkpointName?: string;
  loraName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  order: number;
  visualDescription: string;
  subtitleText: string;
  imageStylePresetId?: string;
  videoStylePresetId?: string;
  keyframeImagePath?: string;
  keyframeThumbnailBase64?: string;
  videoPath?: string;
  trimStartSec: number;
  trimEndSec: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

export interface Storyboard {
  id: string;
  title: string;
  synopsis: string;
  globalStylePresetId?: string;
  shots: Shot[];
  bgmPath?: string;
  createdAt: string;
  updatedAt: string;
}

export type RenderJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface RenderJob {
  id: string;
  kind: 'single_image' | 'storyboard_batch' | 'ffmpeg_export';
  storyboardId?: string;
  sourceJobId?: string;
  prompt?: string;
  stylePresetId?: string;
  stylePresetName?: string;
  checkpointName?: string;
  aspectRatio?: string;
  orientation?: 'portrait' | 'landscape';
  status: RenderJobStatus;
  progress: number;
  errorMessage?: string;
  outputDrivePath?: string;
  thumbnailWebp?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayConfig {
  url: string;
  status: 'online' | 'offline';
  updatedAt: string;
  gpuName?: string;
  vramGb?: number;
  vramMode?: 'high_vram' | 'low_vram';
  workflowTier?: string;
}

export interface BackendGatewayHealth {
  status: 'online';
  service: 'BackendGateway';
  app: string;
  user_email: string;
  checked_at_taipei: string;
  gpu_available: boolean;
  gpu_name: string;
  vram_gb: number;
  vram_mode: 'high_vram' | 'low_vram';
  workflow_tier: string;
}
