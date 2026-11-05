import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_TOLERANCE,
  DEFAULT_EXPORT,
  DEFAULT_STUDIO,
  defaultLayout,
  defaultPlayerLayout,
  even,
  frameSizeForAspect,
  type AspectRatio,
  type ExportContainer,
  type ExportQuality,
  type ExportSettings,
  type ExportVideoCodec,
  type LayoutMode,
  type LayoutSettings,
  type StudioSettings,
} from './studio-types';
import { DEFAULT_SCORE_COLORS, FONT_KEYS, type FontKey, type FontOverride, type ScoreColors } from './score-style';
import { DEFAULT_VIDEO_CODEC, VIDEO_CODECS_BY_CONTAINER } from './offline-export';
import { DEFAULT_CURSOR_STYLE, type CursorStyle } from './video';

const STUDIO_KEY = 'gp-score-player.studio.v1';
const EXPORT_KEY = 'gp-score-player.export.v1';
/**
* Layout memory of the basic preview. The studio layout lives in STUDIO_KEY, so
* both surfaces remember their own mode/zoom and never overwrite each other.
*/
const PLAYER_LAYOUT_KEY = 'gp-score-player.layout.v1';

export interface StoredStudioState {
  studio: StudioSettings;
  layout: LayoutSettings;
}

export interface StoredExportState {
  exportSettings: ExportSettings;
  fontKey: FontKey;
  settingsOpen: boolean;
  cursor: CursorStyle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a locked-down storage policy: memory state still works.
  }
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function hexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function layoutMode(value: unknown, fallback: LayoutMode = 'page'): LayoutMode {
  return value === 'horizontal' || value === 'pageLine' || value === 'page' ? value : fallback;
}

function aspectRatio(value: unknown): AspectRatio {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ASPECT_RATIOS, value)
    ? value as AspectRatio
    : DEFAULT_STUDIO.aspect;
}

function sanitizeFonts(value: unknown): Partial<Record<FontKey, FontOverride>> {
  if (!isRecord(value)) return {};
  const fonts: Partial<Record<FontKey, FontOverride>> = {};
  for (const key of FONT_KEYS) {
    const entry = value[key];
    if (!isRecord(entry)) continue;
    const override: FontOverride = {};
    if (typeof entry.family === 'string' && entry.family.trim()) override.family = entry.family;
    if (typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size > 0) {
      override.size = numberIn(entry.size, 12, 1, 400);
    }
    if (override.family || override.size) fonts[key] = override;
  }
  return fonts;
}

function sanitizeColors(value: unknown): ScoreColors {
  const colors = isRecord(value) ? value : {};
  return {
    main: hexColor(colors.main, DEFAULT_SCORE_COLORS.main),
    staff: hexColor(colors.staff, DEFAULT_SCORE_COLORS.staff),
    bar: hexColor(colors.bar, DEFAULT_SCORE_COLORS.bar),
    barNumber: hexColor(colors.barNumber, DEFAULT_SCORE_COLORS.barNumber),
    info: hexColor(colors.info, DEFAULT_SCORE_COLORS.info),
  };
}

/**
* Sanitizes a stored layout. `base` is a fresh default copy (studio or player)
* and doubles as the value for every missing/invalid field, so the two surfaces
* fall back to their own defaults instead of the studio ones.
*/
function sanitizeLayout(value: unknown, base: LayoutSettings): LayoutSettings {
  if (!isRecord(value)) return base;
  const bars = Math.round(numberIn(value.barsPerRow, base.barsPerRow, -1, 8));
  return {
    mode: layoutMode(value.mode, base.mode),
    scale: numberIn(value.scale, base.scale, 0.25, 4),
    stretch: numberIn(value.stretch, base.stretch, 0.2, 2),
    barsPerRow: bars === 0 ? -1 : bars,
    voice2: Math.round(numberIn(value.voice2, base.voice2, 20, 100)),
    fonts: sanitizeFonts(value.fonts),
    colors: sanitizeColors(value.colors),
  };
}

function sanitizeStudio(value: unknown): StudioSettings {
  if (!isRecord(value)) return { ...DEFAULT_STUDIO };
  return {
    aspect: aspectRatio(value.aspect),
    showHeader: booleanOr(value.showHeader, DEFAULT_STUDIO.showHeader),
    showMargins: booleanOr(value.showMargins, DEFAULT_STUDIO.showMargins),
    theme: value.theme === 'dark' ? 'dark' : 'light',
  };
}

function sanitizeExport(value: unknown, aspect: AspectRatio): ExportSettings {
  const record = isRecord(value) ? value : {};
  const fallback = frameSizeForAspect(aspect, 1080);
  const resolution = record.resolution === '720' || record.resolution === '1080' || record.resolution === 'custom'
    ? record.resolution
    : DEFAULT_EXPORT.resolution;
  let customWidth = even(numberIn(record.customWidth, fallback.width, 2, 4096));
  let customHeight = even(numberIn(record.customHeight, fallback.height, 2, 4096));
  const spec = ASPECT_RATIOS[aspect];
  if (Math.abs((customWidth / customHeight) - (spec.width / spec.height)) > CUSTOM_ASPECT_TOLERANCE) {
    customWidth = fallback.width;
    customHeight = fallback.height;
  }
  const allowedFps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const storedFps = numberIn(record.fps, DEFAULT_EXPORT.fps, 1, 120);
  const container: ExportContainer = record.container === 'mp4' ? 'mp4' : 'webm';
  const containerCodecs = VIDEO_CODECS_BY_CONTAINER[container];
  const videoCodec: ExportVideoCodec = containerCodecs.includes(record.videoCodec as ExportVideoCodec)
    ? record.videoCodec as ExportVideoCodec
    : DEFAULT_VIDEO_CODEC[container];
  const quality: ExportQuality = record.quality === 'low' || record.quality === 'high'
    ? record.quality
    : 'normal';
  return {
    resolution,
    customWidth,
    customHeight,
    fps: allowedFps.includes(storedFps) ? storedFps : DEFAULT_EXPORT.fps,
    includeAudio: booleanOr(record.includeAudio, DEFAULT_EXPORT.includeAudio),
    container,
    videoCodec,
    quality,
  };
}

function sanitizeCursor(value: unknown): CursorStyle {
  const record = isRecord(value) ? value : {};
  const effect = record.effect === 'none' ? 'none' : 'glow';
  return {
    color: hexColor(record.color, DEFAULT_CURSOR_STYLE.color),
    width: numberIn(record.width, DEFAULT_CURSOR_STYLE.width, 1, 12),
    opacity: numberIn(record.opacity, DEFAULT_CURSOR_STYLE.opacity, 0.1, 1),
    effect,
    effectStrength: numberIn(record.effectStrength, DEFAULT_CURSOR_STYLE.effectStrength, 0, 1),
    length: numberIn(record.length, DEFAULT_CURSOR_STYLE.length, 0, 1),
    lookahead: (['off', 'conservative', 'normal', 'aggressive'] as const).includes(record.lookahead as any)
      ? record.lookahead as CursorStyle['lookahead']
      : DEFAULT_CURSOR_STYLE.lookahead,
    smoothing: numberIn(record.smoothing, DEFAULT_CURSOR_STYLE.smoothing, 0, 1),
  };
}

export function loadStudioState(): StoredStudioState {
  const stored = readJson(STUDIO_KEY);
  if (!isRecord(stored)) {
    // First run in this browser: start from the shipped appearance defaults.
    return {
      studio: { ...DEFAULT_STUDIO },
      layout: defaultLayout(),
    };
  }
  return {
    studio: sanitizeStudio(stored.studio),
    layout: sanitizeLayout(stored.layout, defaultLayout()),
  };
}

export function saveStudioState(state: StoredStudioState): void {
  writeJson(STUDIO_KEY, state);
}

export function loadPlayerLayout(): LayoutSettings {
  const layout = sanitizeLayout(readJson(PLAYER_LAYOUT_KEY), defaultPlayerLayout());
  // The single-line framing only exists inside the video workbench, which keeps
  // its own layout; the player always shows a full page or the strip.
  if (layout.mode === 'pageLine') layout.mode = 'page';
  return layout;
}

export function savePlayerLayout(layout: LayoutSettings): void {
  writeJson(PLAYER_LAYOUT_KEY, layout);
}

export function loadExportState(aspect: AspectRatio): StoredExportState {
  const stored = readJson(EXPORT_KEY);
  if (!isRecord(stored)) {
    return {
      exportSettings: sanitizeExport(DEFAULT_EXPORT, aspect),
      fontKey: 'title',
      settingsOpen: true,
      cursor: sanitizeCursor(DEFAULT_CURSOR_STYLE),
    };
  }
  const fontKey = typeof stored.fontKey === 'string' && FONT_KEYS.includes(stored.fontKey as FontKey)
    ? stored.fontKey as FontKey
    : 'title';
  return {
    exportSettings: sanitizeExport(stored.exportSettings, aspect),
    fontKey,
    settingsOpen: booleanOr(stored.settingsOpen, true),
    cursor: sanitizeCursor(stored.cursor),
  };
}

export function saveExportState(state: StoredExportState): void {
  writeJson(EXPORT_KEY, state);
}
