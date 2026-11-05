import { DEFAULT_SCORE_COLORS, type FontKey, type FontOverride, type ScoreColors } from './score-style';

export type Translate = (key: string) => string;
export type LayoutMode = 'page' | 'pageLine' | 'horizontal';
export type MediaKind = 'audio' | 'video';
export type AspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export interface LayoutSettings {
  mode: LayoutMode;
  scale: number;
  stretch: number;
  barsPerRow: number;
  /** Darkness of the secondary voice, 20-100%; 100% matches the primary voice. */
  voice2: number;
  fonts: Partial<Record<FontKey, FontOverride>>;
  colors: ScoreColors;
}

export interface NotationSettings {
  standard: boolean;
  tab: boolean;
}

export interface TrackInfo {
  index: number;
  name: string;
}

export interface ScoreInfo {
  title: string;
  artist: string;
  album: string;
  tempo: number;
  tracks: TrackInfo[];
  hasBackingTrack: boolean;
  bars: number;
  /** Labels matching the numbers printed on the score (pickup bars have no number). */
  barLabels: { label: string; pickup: boolean }[];
}

export interface ExternalMedia {
  name: string;
  kind: MediaKind;
  url: string;
  mime: string;
  offsetSec: number;
}

export type ExportContainer = 'webm' | 'mp4';
export type ExportVideoCodec = 'vp9' | 'vp8' | 'avc';
export type ExportQuality = 'low' | 'normal' | 'high';

export interface ExportSettings {
  resolution: '720' | '1080' | 'custom';
  customWidth: number;
  customHeight: number;
  fps: number;
  includeAudio: boolean;
  /** Output container. WebM carries VP9/VP8 + Opus; MP4 carries H.264/VP9 + AAC. */
  container: ExportContainer;
  videoCodec: ExportVideoCodec;
  /** Relative bitrate quality step; the actual bit rate is derived from the frame size and frame rate. */
  quality: ExportQuality;
}

export type StudioTheme = 'light' | 'dark';

export interface StudioSettings {
  aspect: AspectRatio;
  showHeader: boolean;
  showMargins: boolean;
  /** Surface theme of the exported video. The playhead keeps its own colour. */
  theme: StudioTheme;
}

export interface AspectSpec {
  label: string;
  width: number;
  height: number;
}

export const ASPECT_RATIOS: Record<AspectRatio, AspectSpec> = {
  '16:9': { label: '16:9', width: 16, height: 9 },
  '4:3': { label: '4:3', width: 4, height: 3 },
  '1:1': { label: '1:1', width: 1, height: 1 },
  '3:4': { label: '3:4', width: 3, height: 4 },
  '9:16': { label: '9:16', width: 9, height: 16 },
};

/**
 * Tolerance for judging a custom export size against the canvas aspect ratio.
 * Both the storage sanitizer (on load) and the export dialog (ratio-lock
 * warning and start button) must use the same value, otherwise a stored size
 * could load and then immediately be flagged as mismatched.
 */
export const CUSTOM_ASPECT_TOLERANCE = 0.01;

export const DEFAULT_LAYOUT: LayoutSettings = {
  // First-run appearance. Anything the user changes is stored per browser and
  // keeps winning over these values.
  mode: 'horizontal',
  scale: 1.75,
  stretch: 1.1,
  barsPerRow: -1,
  voice2: 100,
  fonts: { barNumber: { family: 'serif' } },
  colors: DEFAULT_SCORE_COLORS,
};

/**
* First-run layout of the basic preview (the player). The player and the video
* studio keep independent layout settings and independent storage entries, so
* designing a video never changes how the score is browsed afterwards. The
* player therefore starts on a plain page at 100 %, no matter what the studio
* was last set to.
*/
export const DEFAULT_PLAYER_LAYOUT: LayoutSettings = {
  ...DEFAULT_LAYOUT,
  mode: 'page',
  scale: 1,
};

function cloneLayout(base: LayoutSettings): LayoutSettings {
  return {
    ...base,
    fonts: Object.fromEntries(Object.entries(base.fonts).map(([key, value]) => [key, { ...value }])),
    colors: { ...base.colors },
  };
}

/** Fresh copy of the first-run studio layout (nested objects must not be shared). */
export function defaultLayout(): LayoutSettings {
  return cloneLayout(DEFAULT_LAYOUT);
}

/** Fresh copy of the first-run player layout. */
export function defaultPlayerLayout(): LayoutSettings {
  return cloneLayout(DEFAULT_PLAYER_LAYOUT);
}

export const DEFAULT_STUDIO: StudioSettings = {
  aspect: '4:3',
  showHeader: true,
  showMargins: false,
  theme: 'light',
};

export const DEFAULT_EXPORT: ExportSettings = {
  resolution: '1080',
  customWidth: 1440,
  customHeight: 1080,
  fps: 60,
  includeAudio: true,
  // Defaults match the pre-Mediabunny behaviour exactly.
  container: 'webm',
  videoCodec: 'vp9',
  quality: 'normal',
};

export function even(value: number): number {
  const rounded = Math.round(value);
  return rounded + (rounded % 2 === 0 ? 0 : rounded > 0 ? 1 : -1);
}

export function spacingRatioFor(stretch: number): number {
  const ratio = stretch <= 1
    ? 1.2 + (stretch - 0.5) / 0.5 * (Math.SQRT2 - 1.2)
    : Math.SQRT2 + (stretch - 1) * (2 - Math.SQRT2);
  return Math.min(2, Math.max(1.2, ratio));
}

export function frameSizeForAspect(aspect: AspectRatio, shortEdge: number): { width: number; height: number } {
  const spec = ASPECT_RATIOS[aspect];
  // 720p/1080p describe the short edge. For a portrait frame this means
  // 1080p is 1080 px wide (e.g. 1080x1920 for 9:16), which keeps the same
  // visual quality as landscape 1080p.
  if (spec.width >= spec.height) {
    return {
      width: even(shortEdge * spec.width / spec.height),
      height: shortEdge,
    };
  }
  return {
    width: shortEdge,
    height: even(shortEdge * spec.height / spec.width),
  };
}

export function previewFrameSize(aspect: AspectRatio): { width: number; height: number } {
  return frameSizeForAspect(aspect, 720);
}

export function exportFrameSize(settings: ExportSettings, aspect: AspectRatio): { width: number; height: number } {
  if (settings.resolution === 'custom') {
    return {
      width: even(Math.max(2, Math.min(4096, settings.customWidth))),
      height: even(Math.max(2, Math.min(4096, settings.customHeight))),
    };
  }
  return frameSizeForAspect(aspect, settings.resolution === '720' ? 720 : 1080);
}
