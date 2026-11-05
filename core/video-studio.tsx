import type { AlphaTabApi } from '@coderline/alphatab';
import * as alphaTab from '@coderline/alphatab';
import { ReactRuntime } from './runtime';
import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_TOLERANCE,
  exportFrameSize,
  even,
  frameSizeForAspect,
  previewFrameSize,
  spacingRatioFor,
  type AspectRatio,
  type ExportContainer,
  type ExportQuality,
  type ExportSettings,
  type ExportVideoCodec,
  type ExternalMedia,
  type LayoutMode,
  type LayoutSettings,
  type NotationSettings,
  type ScoreInfo,
  type StudioSettings,
  type Translate,
} from './studio-types';
import { FONT_KEYS, scoreColorsForTheme, type FontKey, type FontOverride } from './score-style';
import {
  createCursorSmoothingState,
  cursorFor,
  cursorSmoothingLookahead,
  DEFAULT_CURSOR_STYLE,
  HORIZONTAL_CAMERA_FOLLOW,
  HORIZONTAL_CAMERA_LEAD_SMOOTH,
  layoutVideoCanvas,
  paintVideoFrame,
  renderVideoScore,
  scrollFor,
  scrollXFor,
  smoothCursorX,
  type CursorStyle,
  type VideoScore,
} from './video';
import { loadExportState, saveExportState, type StoredExportState } from './studio-storage';
import {
  buildAudioTimeline,
  buildTickSegments,
  DEFAULT_VIDEO_CODEC,
  estimateVideoBitrate,
  OfflineExportError,
  renderOfflineVideo,
  scoreTimelineMs,
  synthesizeScoreAudio,
  tickAtTime,
  VIDEO_CODECS_BY_CONTAINER,
  videoCodecSupported,
  type OfflineAudioSource,
} from './offline-export';

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

export interface VideoStudioProps {
  t: Translate;
  api: AlphaTabApi | null;
  bytes: Uint8Array | null;
  meta: ScoreInfo | null;
  fileName: string;
  trackIndex: number;
  layout: LayoutSettings;
  notation: NotationSettings;
  external: ExternalMedia | null;
  studio: StudioSettings;
  audioSource: OfflineAudioSource | null;
  barWidths: Record<number, number>;
  barWidthTarget: number;
  onBarWidthTargetChange(index: number): void;
  assetBase: string;
  scriptFile: string;
  fontDirectory: string;
  /** URL of the soundfont, used to synthesize a soundtrack when there is none. */
  soundFontUrl: string;
  exportCodecSupported: boolean;
  onStudioChange(next: StudioSettings): void;
  onLayoutChange(next: LayoutSettings): void;
  onNotationChange(patch: Partial<NotationSettings>): void;
  onTrackChange(index: number): void;
  onBarWidthChange(index: number, value: number): void;
  onBarWidthReset(index?: number): void;
  onClose(): void;
  onNotify(kind: 'info' | 'error' | 'success', text: string): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function baseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'score';
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function audioMime(bytes: Uint8Array): string {
  if (bytes.length >= 4) {
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag === 'RIFF') return 'audio/wav';
    if (tag === 'OggS') return 'audio/ogg';
    if (tag === 'fLaC') return 'audio/flac';
    if (tag.startsWith('ID3')) return 'audio/mpeg';
    if (tag === 'ftyp') return 'audio/mp4';
    if (bytes.length >= 8 && String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === 'ftyp') return 'audio/mp4';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return 'audio/wav';
}

function seekMedia(audio: HTMLMediaElement, target: number): void {
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
  const desired = duration ? Math.min(duration, Math.max(0, target)) : Math.max(0, target);
  try {
    if (!Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime - desired) > 0.08) {
      audio.currentTime = desired;
    }
  } catch { /* seek is best-effort until metadata is ready */ }
}

function StudioIcon(props: { children: any; size?: number }): any {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.children}
    </svg>
  );
}

const BackIcon = () => <StudioIcon><path d="m12.5 4.5-5.5 5.5 5.5 5.5M7 10h9" /></StudioIcon>;
const PlayIcon = () => <StudioIcon size={18}><path d="M6.5 4.3 15 10l-8.5 5.7z" fill="currentColor" stroke="none" /></StudioIcon>;
const PauseIcon = () => <StudioIcon size={18}><path d="M6.5 4.5v11M13.5 4.5v11" /></StudioIcon>;
const ExportIcon = () => <StudioIcon><rect x="3" y="5" width="10" height="10" rx="2" /><path d="m13 8 4-2v8l-4-2" /></StudioIcon>;
const DownloadIcon = () => <StudioIcon><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" /></StudioIcon>;
const SettingsIcon = () => (
  <StudioIcon>
    <g transform="scale(0.8333)" strokeWidth="2.04">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </StudioIcon>
);
const CloseIcon = () => <StudioIcon><path d="m5 5 10 10M15 5 5 15" /></StudioIcon>;
const VolumeOnIcon = () => (
  <StudioIcon>
    <path d="M4 8v4h3l4 3V5L7 8z" />
    <path d="M14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" />
  </StudioIcon>
);
const VolumeOffIcon = () => (
  <StudioIcon>
    <path d="M4 8v4h3l4 3V5L7 8z" />
    <path d="m14 8 4 4m0-4-4 4" />
  </StudioIcon>
);

function CanvasSettings(props: {
  t: Translate;
  studio: StudioSettings;
  frame: { width: number; height: number };
  onChange(next: StudioSettings): void;
}): any {
  const { t, studio, frame, onChange } = props;
  return (
    <>
      <section className="gsp-group">
        <h4>{t('studio.canvas')}</h4>
        <div className="gsp-field">
          <label>{t('studio.aspect')}</label>
          <div className="gsp-vs-ratio-grid">
            {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`gsp-vs-ratio ${studio.aspect === ratio ? 'is-on' : ''}`}
                onClick={() => onChange({ ...studio, aspect: ratio })}
              >
                <span className={`gsp-vs-ratio-shape is-${ratio.replace(':', '-')}`} />
                {ASPECT_RATIOS[ratio].label}
              </button>
            ))}
          </div>
        </div>
        <label className="gsp-check gsp-vs-check">
          <input
            type="checkbox"
            checked={studio.showHeader}
            onChange={(event) => onChange({ ...studio, showHeader: event.target.checked })}
          />
          {t('studio.showHeader')}
        </label>
        <label className="gsp-check gsp-vs-check">
          <input
            type="checkbox"
            checked={studio.showMargins}
            onChange={(event) => onChange({ ...studio, showMargins: event.target.checked })}
          />
          {t('studio.showMargins')}
        </label>
        <div className="gsp-field">
          <label>{t('studio.theme')}</label>
          <div className="gsp-seg gsp-vs-seg">
            {(['light', 'dark'] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                className={studio.theme === theme ? 'is-on' : ''}
                onClick={() => onChange({ ...studio, theme })}
              >
                {theme === 'light' ? t('studio.themeLight') : t('studio.themeDark')}
              </button>
            ))}
          </div>
        </div>
        <p className="gsp-hint">{t('studio.themeHint')}</p>
        <p className="gsp-hint">{t('studio.canvasHint')}</p>
        <div className="gsp-vs-size-readout">
          <span className="gsp-chip is-accent">{frame.width} × {frame.height}</span>
          <span className="gsp-hint" style={{ margin: 0 }}>{t('studio.previewResolution')}</span>
        </div>
      </section>
    </>
  );
}

export function VideoStudio(props: VideoStudioProps): any {
  const { useState, useEffect, useRef, useCallback, useMemo } = ReactRuntime;
  const { t } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const storedExportRef = useRef<StoredExportState | null>(null);
  if (storedExportRef.current === null) storedExportRef.current = loadExportState(props.studio.aspect);
  const initialExportState = storedExportRef.current;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLVideoElement | null>(null);
  const scrollRef = useRef(0);
  const scrollXRef = useRef(0);
  const lastCursorPxRef = useRef<number | null>(null);
  // Last staff system shown; keeps the single-line clip stable when the
  // playhead is momentarily gone at the very end of the score.
  const lastSystemTopRef = useRef<number | null>(null);
  const cursorSmoothRef = useRef(createCursorSmoothingState());
  const lastCameraWallRef = useRef(0);
  const leadVelocityRef = useRef(0);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const mutedRef = useRef(false);
  const pendingPlayRef = useRef(false);
  const audioSmoothRef = useRef(0);
  const renderTokenRef = useRef(0);
  const exportCancelRef = useRef<{ cancelled: boolean } | null>(null);
  const lastExportUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const [fontKey, setFontKey] = useState<FontKey>(initialExportState.fontKey);
  const [previewScore, setPreviewScore] = useState<VideoScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialExportState.settingsOpen);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(initialExportState.exportSettings);
  const [cursorAppearance, setCursorAppearance] = useState<CursorStyle>(initialExportState.cursor ?? DEFAULT_CURSOR_STYLE);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [lastExport, setLastExport] = useState<{ name: string; url: string; size: number } | null>(null);

  const previewSize = useMemo(() => previewFrameSize(props.studio.aspect), [props.studio.aspect]);
  // HiDPI: render the preview backing store with device pixels so the notation
  // and the playhead halo resolve at screen resolution instead of being
  // upscaled by the browser. Every length in the frame layout is proportional
  // to the canvas size, so the composition stays identical to the export.
  // The ratio is re-sampled on browser zoom or when the window moves to a
  // different-DPR monitor: the matchMedia listener fires exactly when the
  // device pixel ratio stops matching the resolution it was registered for,
  // and reregisters itself through the effect dependency.
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    const sync = () => setDpr(window.devicePixelRatio || 1);
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mql.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [dpr]);
  const previewRatio = Math.min(2, Math.max(1, Math.round(dpr * 4) / 4));
  const previewBacking = useMemo(
    () => ({
      width: Math.round(previewSize.width * previewRatio),
      height: Math.round(previewSize.height * previewRatio),
    }),
    [previewSize, previewRatio],
  );
  const trackLabel = useMemo(
    () => props.meta?.tracks.find((entry) => entry.index === props.trackIndex)?.name || '',
    [props.meta, props.trackIndex],
  );
  const title = props.meta?.title || props.fileName || t('header.empty');
  // Length according to the score's own tempo map. It is available as soon as
  // alphaTab built the tick lookup, i.e. without ever starting the player, which
  // is what scores without a backing track need.
  const scoreDuration = useMemo(() => {
    const derived = scoreTimelineMs(props.api);
    return derived > 0 ? derived : (props.api?.endTime || 0);
  }, [props.api]);
  // No embedded/external audio: the studio plays the score with alphaTab's
  // MIDI synthesizer, strictly at the tempo written in the score.
  const midiMode = !props.audioSource;
  const midiPlayback = midiMode && !!props.api;
  // In horizontal mode the zoom slider drives the camera; re-rendering the
  // score at a different scale would be cancelled by the height fit.
  // Page and single-line both render at the zoom slider's layout scale: in the
  // single-line page, zooming in means fewer bars per line, never cropping.
  const scoreScale = props.layout.mode === 'horizontal' ? 1 : props.layout.scale;

  const previewAudio = exportSettings.includeAudio ? props.audioSource : null;
  const audioTimeline = useMemo(() => buildAudioTimeline(previewAudio), [previewAudio]);
  const duration = Math.max(1, audioTimeline.durationMs || scoreDuration || 0);
  const segments = useMemo(
    () => (props.api ? buildTickSegments(props.api, scoreDuration) : []),
    [props.api, scoreDuration],
  );

  useEffect(() => {
    saveExportState({ exportSettings, fontKey, settingsOpen, cursor: cursorAppearance });
  }, [exportSettings, fontKey, settingsOpen, cursorAppearance]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    pendingPlayRef.current = false;
    audioSmoothRef.current = timeRef.current;
    setAudioFailed(false);
    audio.removeAttribute('src');
    audio.load();
    if (!previewAudio) return;

    let objectUrl: string | null = null;
    let src = previewAudio.url;
    if (!src && previewAudio.bytes) {
      const copy = new Uint8Array(previewAudio.bytes.byteLength);
      copy.set(previewAudio.bytes);
      objectUrl = URL.createObjectURL(new Blob([copy.buffer], { type: audioMime(previewAudio.bytes) }));
      src = objectUrl;
    }
    if (!src) return;

    audio.src = src;
    audio.volume = 0.9;
    audio.muted = mutedRef.current;
    audio.load();

    let disposed = false;
    const onLoaded = () => {
      if (disposed || !mountedRef.current) return;
      audio.removeEventListener('loadedmetadata', onLoaded);
      const offset = Math.max(0, previewAudio.offsetSec || 0);
      seekMedia(audio, offset + timeRef.current / 1000);
      if (playingRef.current || pendingPlayRef.current) {
        pendingPlayRef.current = false;
        void audio.play().catch(() => {
          if (mountedRef.current && playingRef.current) {
            setAudioFailed(true);
            props.onNotify('error', t('studio.audioFailed'));
          }
        });
      }
    };
    const onError = () => {
      if (!disposed && mountedRef.current) setAudioFailed(true);
    };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('error', onError);
    if (audio.readyState >= 1) onLoaded();

    return () => {
      disposed = true;
      pendingPlayRef.current = false;
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('error', onError);
      audio.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewAudio, props.onNotify, t]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing) audioRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    mutedRef.current = muted;
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
    if (midiPlayback) {
      // The preview is silent when muted, exactly like a backing track.
      try { if (props.api) props.api.masterVolume = muted ? 0 : 1; } catch { /* ignore */ }
    }
  }, [muted, midiPlayback, props.api]);

  useEffect(() => {
    mountedRef.current = true;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      mountedRef.current = false;
      audioRef.current?.pause();
      const runtime = exportCancelRef.current;
      if (runtime) runtime.cancelled = true;
      if (lastExportUrlRef.current) URL.revokeObjectURL(lastExportUrlRef.current);
    };
  }, []);

  // Reset the custom export size only when the aspect ratio actually changes.
  // Running this on mount too would silently discard a stored custom size
  // (e.g. 2560×1440) every time the studio is opened, because VideoStudio
  // remounts on each studio open.
  const prevAspectRef = useRef<AspectRatio | null>(null);
  useEffect(() => {
    const previous = prevAspectRef.current;
    prevAspectRef.current = props.studio.aspect;
    if (previous === null || previous === props.studio.aspect) return;
    const base = frameSizeForAspect(props.studio.aspect, 1080);
    setExportSettings((current) => {
      if (current.resolution === 'custom' && current.customWidth === base.width && current.customHeight === base.height) return current;
      return { ...current, customWidth: base.width, customHeight: base.height };
    });
  }, [props.studio.aspect]);

  // Page and single-line share the exact same rendered surface; only the
  // camera differs, so a mode switch between them must not re-render the score.
  const renderMode: 'page' | 'horizontal' = props.layout.mode === 'horizontal' ? 'horizontal' : 'page';

  // Build the exact same VideoScore that the encoder will use. This is the
  // expensive part, so debounce rapid slider movement.
  useEffect(() => {
    if (!props.api || !props.bytes) return;
    let cancelled = false;
    setScoreLoading(true);
    setScoreError('');
    const timer = window.setTimeout(async () => {
      const token = ++renderTokenRef.current;
      if (!mountedRef.current) return;
      try {
        const score = await renderVideoScore(alphaTab, {
          mount: mountRef.current ?? document.body,
          bytes: props.bytes!,
          trackIndex: props.trackIndex,
          barsPerRow: props.layout.barsPerRow,
          stretchForce: props.layout.stretch,
          spacingRatio: spacingRatioFor(props.layout.stretch),
          barWidths: props.barWidths,
          scale: scoreScale,
          layoutMode: renderMode,
          voice2: props.layout.voice2,
          fonts: props.layout.fonts,
          colors: scoreColorsForTheme(props.studio.theme, props.layout.colors),
          title,
          artist: props.meta?.artist || '',
          trackName: trackLabel,
          standardNotation: props.notation.standard,
          tablature: props.notation.tab,
          scriptFile: props.scriptFile,
          fontDirectory: props.fontDirectory,
        });
        if (cancelled || token !== renderTokenRef.current || !mountedRef.current) return;
        setPreviewScore(score);
        scrollRef.current = 0;
        scrollXRef.current = 0;
        lastCursorPxRef.current = null;
        lastCameraWallRef.current = 0;
        leadVelocityRef.current = 0;
      } catch (reason) {
        if (cancelled || token !== renderTokenRef.current || !mountedRef.current) return;
        setScoreError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled && token === renderTokenRef.current && mountedRef.current) setScoreLoading(false);
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    props.api,
    props.bytes,
    props.trackIndex,
    renderMode,
    scoreScale,
    props.layout.stretch,
    props.layout.barsPerRow,
    props.layout.voice2,
    props.layout.fonts,
    props.layout.colors,
    props.studio.theme,
    props.barWidths,
    props.notation.standard,
    props.notation.tab,
    props.meta?.artist,
    title,
    trackLabel,
    props.scriptFile,
    props.fontDirectory,
  ]);

  useEffect(() => () => {
    // Leaving the studio must not leave the synthesizer playing.
    try { props.api?.pause(); } catch { /* ignore */ }
  }, [props.api]);

  const drawFrame = useCallback((atMs: number, immediate: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const score = previewScore;
    if (!score) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const horizontal = props.layout.mode === 'horizontal';
    const singleLine = props.layout.mode === 'pageLine';
    const layout = layoutVideoCanvas(canvas.width, canvas.height, score, {
      ...props.studio,
      horizontal,
      singleLine,
      zoom: horizontal ? props.layout.scale : 1,
    });
    const scoreTime = audioTimeline.mapAudioToScore ? audioTimeline.mapAudioToScore(atMs) : atMs;
    const tick = tickAtTime(segments, Math.min(scoreDuration || atMs, scoreTime));
    const cursor = props.api ? cursorFor(props.api, score.beats, new Set([props.trackIndex]), tick) : null;
    const now = performance.now();
    const dt = lastCameraWallRef.current > 0
      ? clamp((now - lastCameraWallRef.current) / 1000, 1 / 240, 0.2)
      : 1 / 60;
    const smoothingAmount = clamp(cursorAppearance.smoothing ?? 0, 0, 1);
    // Presentation-only damping of the playhead. The audio clock and the score
    // time stay untouched; only the drawn position and the camera are filtered.
    let paintCursor = cursor;
    let cursorPx = cursor ? cursor.x * layout.scale : null;
    if (layout.horizontal && cursor && smoothingAmount > 0.001) {
      if (immediate) {
        cursorSmoothRef.current.x = null;
        cursorSmoothRef.current.systemTop = null;
      }
      // Look a little ahead on the known score timeline. A first-order filter
      // delays everything by its time constant; reading the position slightly
      // early cancels most of that delay while the jitter is still damped.
      let sample = cursor;
      const lookaheadMs = immediate ? 0 : cursorSmoothingLookahead(smoothingAmount, cursorAppearance.lookahead) * 1000;
      if (lookaheadMs > 0.5 && props.api) {
        const ahead = cursorFor(
          props.api,
          score.beats,
          new Set([props.trackIndex]),
          tickAtTime(segments, Math.min(scoreDuration || atMs, scoreTime + lookaheadMs)),
        );
        if (ahead && Math.abs(ahead.bounds.systemTop - cursor.bounds.systemTop) < 1) sample = ahead;
      }
      const steadyPx = smoothCursorX(
        cursorSmoothRef.current,
        sample.x * layout.scale,
        cursor.bounds.systemTop,
        immediate ? 0 : dt,
        smoothingAmount,
        layout.scoreW * 0.6,
        cursorPx,
      );
      if (steadyPx !== null) {
        cursorPx = steadyPx;
        paintCursor = { ...cursor, x: layout.scale > 0 ? steadyPx / layout.scale : cursor.x };
      }
    } else {
      cursorSmoothRef.current.x = null;
      cursorSmoothRef.current.systemTop = null;
    }
    const targetY = scrollFor(cursor, score, layout, scrollRef.current);
    const baseTargetX = scrollXFor(paintCursor, score, layout, scrollXRef.current);
    const maxScrollX = Math.max(0, score.width * layout.scale - layout.scoreW + 10);
    if (immediate) {
      scrollRef.current = targetY;
      scrollXRef.current = baseTargetX;
      lastCursorPxRef.current = cursorPx;
      lastCameraWallRef.current = now;
      leadVelocityRef.current = 0;
    } else if (layout.horizontal) {
      // Restore the smooth first-order camera, but lead it by the filter lag so
      // the cursor settles around the center instead of permanently right of it.
      const smoothing = 1 - Math.exp(-HORIZONTAL_CAMERA_FOLLOW * dt);
      let target = baseTargetX;
      if (cursorPx !== null && lastCursorPxRef.current !== null && baseTargetX > 0 && baseTargetX < maxScrollX) {
        const rawVelocity = (cursorPx - lastCursorPxRef.current) / dt;
        leadVelocityRef.current += (rawVelocity - leadVelocityRef.current)
          * (1 - Math.exp(-HORIZONTAL_CAMERA_LEAD_SMOOTH * dt));
        target += leadVelocityRef.current / HORIZONTAL_CAMERA_FOLLOW;
      }
      target = clamp(target, 0, maxScrollX);
      scrollXRef.current += (target - scrollXRef.current) * smoothing;
      scrollRef.current = 0;
      lastCursorPxRef.current = cursorPx;
      lastCameraWallRef.current = now;
    } else if (layout.singleLine) {
      // One line at a time: jump straight to the active line's framing. No
      // easing here on purpose - a line change must not slide, horizontally
      // either.
      scrollRef.current = targetY;
      scrollXRef.current = baseTargetX;
      lastCursorPxRef.current = null;
      lastCameraWallRef.current = now;
    } else {
      // Vertical camera damping from the wall-clock delta, matching the export
      // path's per-frame 1/fps step (offline-export.ts). A hardcoded /60 would
      // run at a different speed on any non-60 Hz display.
      const smoothing = 1 - Math.exp(-5.5 * dt);
      scrollRef.current += (targetY - scrollRef.current) * smoothing;
      scrollXRef.current = 0;
      lastCursorPxRef.current = null;
      lastCameraWallRef.current = now;
    }
    if (paintCursor) lastSystemTopRef.current = paintCursor.bounds.systemTop;
    paintVideoFrame(ctx, score, layout, {
      scrollY: scrollRef.current,
      scrollX: scrollXRef.current,
      cursor: paintCursor,
      systemTop: paintCursor ? paintCursor.bounds.systemTop : lastSystemTopRef.current ?? undefined,
      accent: '#436d9d',
      trackLabel,
      cursorStyle: cursorAppearance,
    });
  }, [
    previewScore,
    props.studio,
    props.api,
    props.trackIndex,
    audioTimeline,
    segments,
    scoreDuration,
    duration,
    trackLabel,
    props.layout.mode,
    props.layout.scale,
    cursorAppearance,
  ]);

  useEffect(() => {
    if (timeRef.current > duration) {
      timeRef.current = duration;
      setTime(duration);
    }
    drawFrame(timeRef.current, true);
  }, [drawFrame, duration, previewBacking.width, previewBacking.height]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = last;
    const step = (now: number) => {
      const dt = Math.min(0.12, (now - last) / 1000);
      last = now;
      let next = timeRef.current + dt * 1000;
      const audio = audioRef.current;
      let sourceMs: number | null = null;
      if (previewAudio && audio && !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 2) {
        const offset = Math.max(0, previewAudio.offsetSec || 0);
        const audioTime = (audio.currentTime - offset) * 1000;
        if (Number.isFinite(audioTime) && audioTime >= 0) sourceMs = audioTime;
      } else if (midiPlayback) {
        // The synthesizer is the clock for scores without a backing track.
        const api = props.api;
        if (api && api.playerState === alphaTab.synth.PlayerState.Playing) {
          const position = api.timePosition;
          if (Number.isFinite(position) && position >= 0) sourceMs = position;
        }
      }
      if (sourceMs !== null) {
        // Media/synth clocks update in coarse steps. Advance a local predicted
        // clock every frame and pull it toward the source clock with a slow,
        // monotonic correction. This keeps the cursor fluid while remaining
        // phase-locked to the sound.
        const predicted = audioSmoothRef.current + dt * 1000;
        const error = sourceMs - predicted;
        if (Math.abs(error) > 800) {
          audioSmoothRef.current = sourceMs;
        } else {
          audioSmoothRef.current = Math.max(
            audioSmoothRef.current,
            predicted + error * 0.03,
          );
        }
        next = audioSmoothRef.current;
      } else {
        audioSmoothRef.current = timeRef.current;
      }
      if (next >= duration) {
        timeRef.current = duration;
        setTime(duration);
        drawFrame(duration, false);
        playingRef.current = false;
        audioSmoothRef.current = duration;
        setPlaying(false);
        audio?.pause();
        try { props.api?.pause(); } catch { /* ignore */ }
        return;
      }
      timeRef.current = next;
      drawFrame(next, false);
      if (now - lastUi > 100) {
        lastUi = now;
        setTime(next);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, drawFrame, previewAudio, midiPlayback, props.api]);

  const startMidi = useCallback(() => {
    const api = props.api;
    if (!api) return;
    try {
      // Strictly the written tempo: no speed change, no count-in, no metronome,
      // no loop - the video timeline must match the score exactly.
      api.playbackSpeed = 1;
      api.countInVolume = 0;
      api.metronomeVolume = 0;
      api.isLooping = false;
      api.timePosition = timeRef.current;
      api.play();
    } catch {
      if (mountedRef.current && playingRef.current) {
        props.onNotify('error', t('studio.audioFailed'));
      }
    }
  }, [props.api, props.onNotify, t]);

  const startAudio = useCallback(() => {
    if (!previewAudio) {
      if (midiPlayback) startMidi();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src) {
      pendingPlayRef.current = true;
      return;
    }
    audio.muted = mutedRef.current;
    setAudioFailed(false);
    const offset = Math.max(0, previewAudio.offsetSec || 0);
    const target = offset + timeRef.current / 1000;
    const play = () => {
      seekMedia(audio, target);
      void audio.play().catch(() => {
        if (mountedRef.current && playingRef.current) {
          setAudioFailed(true);
          props.onNotify('error', t('studio.audioFailed'));
        }
      });
    };
    if (audio.readyState >= 1) play();
    else pendingPlayRef.current = true;
  }, [previewAudio, midiPlayback, startMidi, props.onNotify, t]);

  const seek = useCallback((value: number) => {
    const next = clamp(Number.isFinite(value) ? value : 0, 0, duration);
    timeRef.current = next;
    audioSmoothRef.current = next;
    setTime(next);
    playingRef.current = false;
    pendingPlayRef.current = false;
    audioRef.current?.pause();
    try { props.api?.pause(); } catch { /* ignore */ }
    if (midiPlayback && props.api) {
      try { props.api.timePosition = next; } catch { /* ignore */ }
    }
    setPlaying(false);
    if (audioRef.current && previewAudio && audioRef.current.readyState >= 1) {
      const offset = Math.max(0, previewAudio.offsetSec || 0);
      seekMedia(audioRef.current, offset + next / 1000);
    }
    drawFrame(next, true);
  }, [duration, drawFrame, previewAudio, midiPlayback, props.api]);

  const togglePreview = useCallback(() => {
    if (!previewScore || duration <= 0) return;
    if (playing) {
      playingRef.current = false;
      pendingPlayRef.current = false;
      setPlaying(false);
      audioRef.current?.pause();
      try { props.api?.pause(); } catch { /* ignore */ }
      return;
    }
    if (timeRef.current >= duration - 1) {
      timeRef.current = 0;
      setTime(0);
      drawFrame(0, true);
    }
    playingRef.current = true;
    audioSmoothRef.current = timeRef.current;
    // The pause may have lasted seconds; do not let the first playback frame
    // look like one huge step in the camera and playhead filters.
    lastCameraWallRef.current = 0;
    setPlaying(true);
    startAudio();
  }, [previewScore, duration, playing, drawFrame, startAudio]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (exportOpen && !exporting) {
          setExportOpen(false);
          return;
        }
        if (!exporting) props.onClose();
        return;
      }
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (exportOpen || exporting) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      togglePreview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exportOpen, exporting, props.onClose, togglePreview]);

  const selectedFont = props.layout.fonts?.[fontKey] ?? {};
  const applyFont = (patch: Partial<FontOverride>) => {
    props.onLayoutChange({
      ...props.layout,
      fonts: {
        ...props.layout.fonts,
        [fontKey]: { ...props.layout.fonts?.[fontKey], ...patch },
      },
    });
  };
  const clearFont = () => {
    const fonts = { ...props.layout.fonts };
    delete fonts[fontKey];
    props.onLayoutChange({ ...props.layout, fonts });
  };

  const updateCustom = (which: 'width' | 'height', raw: number) => {
    const spec = ASPECT_RATIOS[props.studio.aspect];
    const value = clamp(Number.isFinite(raw) ? raw : 240, 128, 4096);
    let width = which === 'width' ? value : value * spec.width / spec.height;
    let height = which === 'height' ? value : value * spec.height / spec.width;
    // Keep the canvas ratio and leave enough pixels on the short edge even
    // when the user edits the long edge first.
    const shortSide = Math.min(width, height);
    if (shortSide < 240) {
      const grow = 240 / shortSide;
      width *= grow;
      height *= grow;
    }
    const shrink = Math.min(1, 4096 / width, 4096 / height);
    width = even(width * shrink);
    height = even(height * shrink);
    setExportSettings((current) => ({
      ...current,
      resolution: 'custom',
      customWidth: width,
      customHeight: height,
    }));
  };

  const outputFrame = exportFrameSize(exportSettings, props.studio.aspect);
  const aspectSpec = ASPECT_RATIOS[props.studio.aspect];
  const customMatchesAspect = exportSettings.resolution !== 'custom'
    || Math.abs((exportSettings.customWidth / exportSettings.customHeight) - (aspectSpec.width / aspectSpec.height)) < CUSTOM_ASPECT_TOLERANCE;

  // Probe which video codecs this browser can actually encode at the target
  // geometry (H.264 availability depends on profile/level support for the
  // resolution). Unsupported options get disabled in the dialog and an invalid
  // selection falls back to the first supported codec of the container.
  const [codecSupport, setCodecSupport] = useState<Partial<Record<ExportVideoCodec, boolean>>>({});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const results: Partial<Record<ExportVideoCodec, boolean>> = {};
      for (const codec of ['vp9', 'vp8', 'avc'] as ExportVideoCodec[]) {
        try {
          results[codec] = await videoCodecSupported(codec, outputFrame.width, outputFrame.height, exportSettings.fps);
        } catch {
          results[codec] = false;
        }
      }
      if (cancelled) return;
      setCodecSupport(results);
      setExportSettings((current) => {
        const valid = VIDEO_CODECS_BY_CONTAINER[current.container];
        if (valid.includes(current.videoCodec) && results[current.videoCodec] !== false) return current;
        // Stable sort keeps the container's preference order among supported codecs.
        const candidates = [...valid].sort((a, b) => Number(results[b] === true) - Number(results[a] === true));
        const next = candidates.find((codec) => results[codec] !== false);
        return next && next !== current.videoCodec ? { ...current, videoCodec: next } : current;
      });
    })();
    return () => { cancelled = true; };
  }, [outputFrame.width, outputFrame.height, exportSettings.fps]);

  const copySettings = async () => {
    const payload = {
      studio: props.studio,
      layout: props.layout,
      cursor: cursorAppearance,
      exportSettings,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      props.onNotify('success', t('studio.settingsCopied'));
    } catch {
      props.onNotify('error', t('studio.settingsCopyFailed'));
    }
  };

  const openExport = () => {
    if (!previewScore || scoreLoading || scoreError || exporting) return;
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    setExportError('');
    setExportOpen(true);
  };

  const startExport = async () => {
    if (!props.api || !previewScore || scoreLoading || scoreError || exporting) return;
    if (!props.exportCodecSupported) {
      setExportError(t('export.noCodecs'));
      return;
    }
    const frame = exportFrameSize(exportSettings, props.studio.aspect);
    if (frame.width > 4096 || frame.height > 4096) {
      setExportError(t('export.tooLarge'));
      return;
    }
    const runtime = { cancelled: false };
    exportCancelRef.current = runtime;
    setExportOpen(false);
    setExportError('');
    setExporting(true);
    setExportProgress(0);
    setExportMessage(t('export.preparing'));
    playingRef.current = false;
    setPlaying(false);
    audioRef.current?.pause();
    try { props.api?.pause(); } catch { /* ignore */ }
    try {
      // Soundtrack: the backing/external audio, or - when the score has none -
      // the score itself rendered with alphaTab's MIDI synthesizer.
      let soundtrack: OfflineAudioSource | null = exportSettings.includeAudio ? props.audioSource : null;
      if (!soundtrack && exportSettings.includeAudio && midiMode) {
        setExportMessage(t('export.midiAudio'));
        setExportProgress(1);
        try {
          const rendered = await synthesizeScoreAudio(props.api, props.soundFontUrl, (ratio) => {
            if (!mountedRef.current || runtime.cancelled) return;
            setExportProgress(1 + ratio * 5);
            setExportMessage(t('export.midiAudio'));
          });
          soundtrack = {
            bytes: rendered.bytes,
            offsetSec: 0,
            // Identity map: the synth follows the score's own tempo, so audio
            // time and score time are the same timeline.
            syncPoints: [
              { audioMs: 0, scoreMs: 0 },
              { audioMs: rendered.durationMs, scoreMs: rendered.durationMs },
            ],
          };
        } catch (error) {
          if (runtime.cancelled) throw error;
          props.onNotify('info', t('export.midiAudioFailed'));
        }
      }
      const withAudio = !!soundtrack;
      const result = await renderOfflineVideo({
        api: props.api,
        score: previewScore,
        width: frame.width,
        height: frame.height,
        fps: exportSettings.fps,
        durationMs: scoreDuration,
        trackIndexes: new Set([props.trackIndex]),
        trackLabel,
        accent: '#436d9d',
        cursorStyle: cursorAppearance,
        layout: {
          showHeader: props.studio.showHeader,
          showMargins: props.studio.showMargins,
          horizontal: props.layout.mode === 'horizontal',
          singleLine: props.layout.mode === 'pageLine',
          zoom: props.layout.scale,
          theme: props.studio.theme,
        },
        audio: soundtrack,
        container: exportSettings.container,
        videoCodec: exportSettings.videoCodec,
        quality: exportSettings.quality,
        onProgress: (progress, phase) => {
          if (!mountedRef.current || runtime.cancelled) return;
          setExportProgress(progress);
          setExportMessage(
            phase === 'finalize'
              ? t('export.finalizing')
              : phase === 'audio'
                ? t('export.audio')
                : t('export.recording'),
          );
        },
        isCancelled: () => runtime.cancelled,
      });
      if (runtime.cancelled) throw new Error(t('export.cancelled'));
      const extension = result.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const name = `${baseName(props.meta?.title || props.fileName || 'score')}-${frame.width}x${frame.height}-${exportSettings.fps}fps-${new Date().toISOString().slice(0, 10)}.${extension}`;
      if (lastExportUrlRef.current) URL.revokeObjectURL(lastExportUrlRef.current);
      const url = URL.createObjectURL(result.blob);
      lastExportUrlRef.current = url;
      setLastExport({ name, url, size: result.blob.size });
      downloadBlob(result.blob, name);
      setExportProgress(100);
      setExportMessage(t('export.done'));
      if (withAudio && !result.hasAudio) props.onNotify('info', t('export.audioFailed'));
      else props.onNotify('success', t('toast.exportDone'));
    } catch (reason) {
      if (runtime.cancelled) {
        props.onNotify('info', t('export.cancelled'));
      } else {
        const message = reason instanceof OfflineExportError
          ? t(reason.key)
          : reason instanceof Error ? reason.message : String(reason);
        setExportError(message);
        props.onNotify('error', `${t('export.failed')}: ${message}`);
      }
    } finally {
      if (exportCancelRef.current === runtime) exportCancelRef.current = null;
      if (mountedRef.current) setExporting(false);
    }
  };

  const cancelExport = () => {
    const runtime = exportCancelRef.current;
    if (runtime) runtime.cancelled = true;
    setExportMessage(t('export.cancelling'));
  };

  const previewAudioLabel = midiMode
    ? muted
      ? t('studio.mutedPreview')
      : t('studio.midiPreview')
    : !previewAudio
      ? t('studio.silentPreview')
      : audioFailed
        ? t('studio.audioUnavailable')
        : muted
          ? t('studio.mutedPreview')
          : t('studio.audioPreview');

  const close = () => {
    if (exporting) return;
    props.onClose();
  };

  return (
    <div ref={rootRef} className={`gsp-studio ${settingsOpen ? 'has-settings' : ''}`} tabIndex={-1}>
      <header className="gsp-vs-top">
        <button type="button" className="gsp-vs-back" onClick={close} disabled={exporting} title={t('studio.back')}>
          <BackIcon />
          <span>{t('studio.back')}</span>
        </button>
        <div className="gsp-vs-heading">
          <strong>{t('studio.title')}</strong>
          <span title={title}>{title}</span>
        </div>
        <div className="gsp-vs-top-actions">
          <span className="gsp-vs-frame-chip">{previewSize.width} × {previewSize.height}</span>
          <button
            type="button"
            className={`gsp-vs-icon ${settingsOpen ? 'is-on' : ''}`}
            onClick={() => setSettingsOpen((open) => !open)}
            title={settingsOpen ? t('studio.hideSettings') : t('studio.showSettings')}
            aria-label={settingsOpen ? t('studio.hideSettings') : t('studio.showSettings')}
          >
            <SettingsIcon />
          </button>
          <button
            type="button"
            className="gsp-btn is-primary gsp-vs-export"
            onClick={openExport}
            disabled={!previewScore || scoreLoading || !!scoreError || exporting || !props.exportCodecSupported}
          >
            <ExportIcon />
            {t('studio.export')}
          </button>
        </div>
      </header>

      <div className="gsp-vs-body">
        <main className="gsp-vs-preview">
          <div className="gsp-vs-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={previewBacking.width}
              height={previewBacking.height}
              className="gsp-vs-canvas"
              aria-label={t('studio.preview')}
            />
            {scoreLoading && (
              <div className="gsp-vs-overlay">
                <span className="gsp-spinner" />
                {t('studio.loadingPreview')}
              </div>
            )}
            {!scoreLoading && scoreError && (
              <div className="gsp-vs-overlay is-error">
                <strong>{t('studio.previewFailed')}</strong>
                <span>{scoreError}</span>
              </div>
            )}
            {exporting && (
              <div className="gsp-vs-overlay is-exporting">
                <div className="gsp-vs-export-progress-head">
                  <span>{exportMessage || t('export.recording')}</span>
                  <strong>{Math.round(exportProgress)}%</strong>
                </div>
                <div className="gsp-big-progress"><span style={{ width: `${clamp(exportProgress, 0, 100)}%` }} /></div>
                <div className="gsp-vs-export-progress-actions">
                  <span>{outputFrame.width} × {outputFrame.height} · {exportSettings.fps} fps</span>
                  <button type="button" className="gsp-btn is-small" onClick={cancelExport}>{t('export.cancel')}</button>
                </div>
              </div>
            )}
          </div>

          <div className="gsp-vs-transport">
            <button
              type="button"
              className="gsp-vs-play"
              onClick={togglePreview}
              disabled={!previewScore || duration <= 0 || exporting}
              title={playing ? t('pause') : t('studio.playPreview')}
              aria-label={playing ? t('pause') : t('studio.playPreview')}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <span className="gsp-vs-time">{formatClock(time)} / {formatClock(duration)}</span>
            <input
              className="gsp-vs-range"
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={10}
              value={clamp(time, 0, Math.max(1, duration))}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={!previewScore || duration <= 0 || exporting}
              aria-label={t('studio.preview')}
            />
            {previewAudio && (
              <button
                type="button"
                className={`gsp-vs-mute ${muted ? 'is-muted' : ''}`}
                onClick={() => setMuted((value) => !value)}
                disabled={audioFailed}
                title={muted ? t('studio.unmute') : t('studio.mute')}
                aria-label={muted ? t('studio.unmute') : t('studio.mute')}
                aria-pressed={muted}
              >
                {muted ? <VolumeOffIcon /> : <VolumeOnIcon />}
              </button>
            )}
            <span className="gsp-vs-preview-chip">{previewAudioLabel}</span>
          </div>

          {exportError && <div className="gsp-vs-error">{exportError}</div>}
          {lastExport && (
            <div className="gsp-vs-result">
              <span>{t('export.done')}</span>
              <a className="gsp-btn is-small" href={lastExport.url} download={lastExport.name}>
                <DownloadIcon /> {lastExport.name} · {(lastExport.size / 1024 / 1024).toFixed(1)} MB
              </a>
            </div>
          )}
        </main>

        {settingsOpen && (
          <aside className="gsp-vs-side" aria-label={t('studio.settings')}>
            <div className="gsp-vs-side-head">
              <h3>{t('studio.settings')}</h3>
              <button
                type="button"
                className="gsp-btn is-small is-ghost"
                onClick={() => void copySettings()}
              >
                {t('studio.copySettings')}
              </button>
              <button type="button" className="gsp-side-close" onClick={() => setSettingsOpen(false)} aria-label={t('common.close')}>
                <CloseIcon />
              </button>
            </div>
            <fieldset className="gsp-vs-fieldset" disabled={exporting}>
              <div className="gsp-vs-side-body">
                <CanvasSettings
                  t={t}
                  studio={props.studio}
                  frame={previewSize}
                  onChange={props.onStudioChange}
                />

                <section className="gsp-group">
                  <h4>{t('studio.cursor')}</h4>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-color">{t('studio.cursorColor')}</label>
                    <input
                      id="gsp-vs-cursor-color"
                      className="gsp-color"
                      type="color"
                      value={cursorAppearance.color}
                      onChange={(event) => setCursorAppearance((current) => ({ ...current, color: event.target.value }))}
                    />
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-width">
                      {t('studio.cursorWidth')}
                      <span className="gsp-help" title={t('studio.cursorHint')} aria-label={t('studio.cursorHint')} tabIndex={0}>!</span>
                    </label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-cursor-width"
                        type="range"
                        min={1}
                        max={12}
                        step={0.5}
                        value={cursorAppearance.width}
                        onChange={(event) => setCursorAppearance((current) => ({ ...current, width: Number(event.target.value) }))}
                      />
                      <span className="gsp-value">{cursorAppearance.width}px</span>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-opacity">{t('studio.cursorOpacity')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-cursor-opacity"
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={Math.round(cursorAppearance.opacity * 100)}
                        onChange={(event) => setCursorAppearance((current) => ({ ...current, opacity: Number(event.target.value) / 100 }))}
                      />
                      <span className="gsp-value">{Math.round(cursorAppearance.opacity * 100)}%</span>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-effect">{t('studio.cursorEffect')}</label>
                    <select
                      id="gsp-vs-cursor-effect"
                      className="gsp-select"
                      value={cursorAppearance.effect}
                      onChange={(event) => setCursorAppearance((current) => ({ ...current, effect: event.target.value as CursorStyle['effect'] }))}
                    >
                      <option value="none">{t('studio.cursorEffectNone')}</option>
                      <option value="glow">{t('studio.cursorEffectGlow')}</option>
                    </select>
                  </div>
                  {cursorAppearance.effect !== 'none' && (
                    <div className="gsp-field">
                      <label htmlFor="gsp-vs-cursor-strength">{t('studio.cursorStrength')}</label>
                      <div className="gsp-inline">
                        <input
                          id="gsp-vs-cursor-strength"
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(cursorAppearance.effectStrength * 100)}
                          onChange={(event) => setCursorAppearance((current) => ({ ...current, effectStrength: Number(event.target.value) / 100 }))}
                        />
                        <span className="gsp-value">{Math.round(cursorAppearance.effectStrength * 100)}%</span>
                      </div>
                    </div>
                  )}
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-length">{t('studio.cursorLength')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-cursor-length"
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round((cursorAppearance.length ?? DEFAULT_CURSOR_STYLE.length) * 100)}
                        onChange={(event) => setCursorAppearance((current) => ({ ...current, length: Number(event.target.value) / 100 }))}
                      />
                      <span className="gsp-value">{Math.round((cursorAppearance.length ?? DEFAULT_CURSOR_STYLE.length) * 100)}%</span>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-cursor-smoothing">
                      {t('studio.cursorSmoothing')}
                      <span className="gsp-help" title={t('studio.cursorSmoothingHint')} aria-label={t('studio.cursorSmoothingHint')} tabIndex={0}>!</span>
                    </label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-cursor-smoothing"
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round((cursorAppearance.smoothing ?? 0) * 100)}
                        onChange={(event) => setCursorAppearance((current) => ({ ...current, smoothing: Number(event.target.value) / 100 }))}
                      />
                      <span className="gsp-value">{Math.round((cursorAppearance.smoothing ?? 0) * 100)}%</span>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label>
                      {t('studio.cursorLookahead')}
                      <span className="gsp-help" title={t('studio.cursorLookaheadHint')} aria-label={t('studio.cursorLookaheadHint')} tabIndex={0}>!</span>
                    </label>
                    <div className="gsp-seg gsp-vs-seg">
                      {(['off', 'conservative', 'normal', 'aggressive'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={cursorAppearance.lookahead === mode ? 'is-on' : ''}
                          onClick={() => setCursorAppearance((current) => ({ ...current, lookahead: mode }))}
                        >
                          {t(`studio.lookahead.${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                </section>

                <section className="gsp-group">
                  <h4>{t('layout.title')}</h4>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-mode">{t('layout.mode')}</label>
                    <select
                      id="gsp-vs-mode"
                      className="gsp-select"
                      value={props.layout.mode}
                      onChange={(event) => props.onLayoutChange({ ...props.layout, mode: event.target.value as LayoutMode })}
                    >
                      {(['page', 'pageLine', 'horizontal'] as LayoutMode[]).map((mode) => (
                        <option key={mode} value={mode}>{t(`layout.${mode}`)}</option>
                      ))}
                    </select>
                  </div>
                  {props.layout.mode === 'horizontal' && <p className="gsp-hint">{t('studio.horizontalHint')}</p>}
                  {props.layout.mode === 'pageLine' && <p className="gsp-hint">{t('studio.singleLineHint')}</p>}
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-scale">{t('layout.scale')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-scale"
                        type="range"
                        min={25}
                        max={400}
                        step={5}
                        value={Math.round(props.layout.scale * 100)}
                        onChange={(event) => props.onLayoutChange({ ...props.layout, scale: Number(event.target.value) / 100 })}
                      />
                      <span className="gsp-value">{Math.round(props.layout.scale * 100)}%</span>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-stretch">{t('layout.stretch')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-stretch"
                        type="range"
                        min={20}
                        max={200}
                        step={5}
                        value={Math.round(props.layout.stretch * 100)}
                        onChange={(event) => props.onLayoutChange({ ...props.layout, stretch: Number(event.target.value) / 100 })}
                      />
                      <span className="gsp-value">{Math.round(props.layout.stretch * 100)}%</span>
                    </div>
                  </div>
                  <p className="gsp-hint">{t('layout.stretchHint')}</p>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-bars">{t('layout.barsPerRow')}</label>
                    <select
                      id="gsp-vs-bars"
                      className="gsp-select"
                      value={props.layout.barsPerRow}
                      onChange={(event) => props.onLayoutChange({ ...props.layout, barsPerRow: Number(event.target.value) })}
                      disabled={props.layout.mode === 'horizontal'}
                    >
                      <option value={-1}>{t('layout.auto')}</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                        <option key={count} value={count}>{count}</option>
                      ))}
                    </select>
                  </div>
                  <div className="gsp-field">
                    <label>{t('layout.notation')}</label>
                    <div className="gsp-inline">
                      <label className="gsp-check">
                        <input
                          type="checkbox"
                          checked={props.notation.standard}
                          onChange={(event) => props.onNotationChange({ standard: event.target.checked })}
                        />
                        {t('layout.standard')}
                      </label>
                      <label className="gsp-check">
                        <input
                          type="checkbox"
                          checked={props.notation.tab}
                          onChange={(event) => props.onNotationChange({ tab: event.target.checked })}
                        />
                        {t('layout.tab')}
                      </label>
                    </div>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-voice2">{t('layout.voice2')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-voice2"
                        type="range"
                        min={20}
                        max={100}
                        step={5}
                        value={props.layout.voice2}
                        onChange={(event) => props.onLayoutChange({ ...props.layout, voice2: Number(event.target.value) })}
                      />
                      <span className="gsp-value">{props.layout.voice2}%</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="gsp-btn is-small is-ghost"
                    onClick={() => props.onLayoutChange({
                      ...props.layout,
                      mode: 'page',
                      scale: 1,
                      stretch: 1,
                      barsPerRow: -1,
                      voice2: 100,
                    })}
                  >
                    {t('layout.reset')}
                  </button>
                </section>

                <section className="gsp-group">
                  <h4>{t('layout.barWidths')}</h4>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-bar-target">{t('layout.bar')}</label>
                    <select
                      id="gsp-vs-bar-target"
                      className="gsp-select"
                      value={props.barWidthTarget}
                      onChange={(event) => props.onBarWidthTargetChange(Number(event.target.value))}
                      disabled={!props.meta?.bars}
                    >
                      {(props.meta?.barLabels ?? []).map((bar, index) => (
                        <option key={index + 1} value={index + 1}>
                          {bar.pickup ? t('layout.pickupBar') : (bar.label || t('layout.barNumberFallback').replace('{n}', String(index + 1)))}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-bar-width">{t('layout.barWidth')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-bar-width"
                        type="range"
                        min={50}
                        max={200}
                        step={5}
                        value={props.barWidths[props.barWidthTarget] ?? 100}
                        onChange={(event) => props.onBarWidthChange(props.barWidthTarget, Number(event.target.value))}
                        disabled={!props.meta?.bars}
                      />
                      <span className="gsp-value">{props.barWidths[props.barWidthTarget] ?? 100}%</span>
                    </div>
                  </div>
                  <div className="gsp-inline" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="gsp-btn is-small is-ghost"
                      disabled={!props.barWidths[props.barWidthTarget]}
                      onClick={() => props.onBarWidthReset(props.barWidthTarget)}
                    >
                      {t('layout.barWidthReset')}
                    </button>
                    <button
                      type="button"
                      className="gsp-btn is-small is-ghost"
                      disabled={!Object.keys(props.barWidths).length}
                      onClick={() => props.onBarWidthReset()}
                    >
                      {t('layout.barWidthResetAll')}
                    </button>
                  </div>
                  <p className="gsp-hint">{t('layout.barWidthHint')}</p>
                </section>

                <section className="gsp-group">
                  <h4>{t('layout.colors')}</h4>
                  {([
                    ['main', 'layout.colorMain'],
                    ['staff', 'layout.colorStaff'],
                    ['bar', 'layout.colorBar'],
                    ['barNumber', 'layout.colorBarNumber'],
                    ['info', 'layout.colorInfo'],
                  ] as const).map(([key, label]) => (
                    <div className="gsp-field" key={key}>
                      <label htmlFor={`gsp-vs-color-${key}`}>{t(label)}</label>
                      <input
                        id={`gsp-vs-color-${key}`}
                        className="gsp-color"
                        type="color"
                        value={props.layout.colors[key]}
                        onChange={(event) => props.onLayoutChange({
                          ...props.layout,
                          colors: { ...props.layout.colors, [key]: event.target.value },
                        })}
                      />
                    </div>
                  ))}
                </section>

                <section className="gsp-group">
                  <h4>{t('layout.fonts')}</h4>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-font-element">{t('layout.fontElement')}</label>
                    <select
                      id="gsp-vs-font-element"
                      className="gsp-select"
                      value={fontKey}
                      onChange={(event) => setFontKey(event.target.value as FontKey)}
                    >
                      {FONT_KEYS.map((key) => (
                        <option key={key} value={key}>{t(`layout.font.${key}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-font-family">{t('layout.fontFamily')}</label>
                    <input
                      id="gsp-vs-font-family"
                      className="gsp-input"
                      type="text"
                      value={selectedFont.family ?? ''}
                      placeholder={t('layout.fontDefault')}
                      onChange={(event) => applyFont({ family: event.target.value })}
                    />
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-font-size">{t('layout.fontSize')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-vs-font-size"
                        className="gsp-input"
                        type="number"
                        min={6}
                        max={72}
                        step={1}
                        value={selectedFont.size ?? ''}
                        placeholder={t('layout.fontDefault')}
                        onChange={(event) => {
                          const size = Number(event.target.value);
                          applyFont({ size: Number.isFinite(size) && size > 0 ? size : undefined });
                        }}
                      />
                      <button type="button" className="gsp-btn is-small is-ghost" onClick={clearFont}>
                        {t('layout.fontClear')}
                      </button>
                    </div>
                  </div>
                  <p className="gsp-hint">{t('layout.fontHint')}</p>
                </section>

                <section className="gsp-group">
                  <h4>{t('studio.track')}</h4>
                  <div className="gsp-field">
                    <label htmlFor="gsp-vs-track">{t('layout.track')}</label>
                    <select
                      id="gsp-vs-track"
                      className="gsp-select"
                      value={props.trackIndex}
                      onChange={(event) => props.onTrackChange(Number(event.target.value))}
                    >
                      {(props.meta?.tracks ?? []).map((track) => (
                        <option key={track.index} value={track.index}>{track.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="gsp-vs-source">
                    <span className="gsp-chip">{props.external ? props.external.name : props.meta?.hasBackingTrack ? t('audio.embedded') : t('studio.midiSource')}</span>
                  </div>
                  {/* The chip is a single-line label; the full sentence has to wrap
                      into a hint, otherwise it widens the whole side panel. */}
                  {midiMode && <p className="gsp-hint">{t('export.noAudioTrack')}</p>}
                </section>

                {!props.exportCodecSupported && (
                  <p className="gsp-hint is-warning">{t('export.noCodecs')}</p>
                )}
              </div>
            </fieldset>
            <div className="gsp-vs-side-foot">{t('studio.persistHint')}</div>
          </aside>
        )}
      </div>

      <video ref={audioRef} className="gsp-vs-audio" playsInline preload="auto" aria-hidden="true" />
      <div ref={mountRef} className="gsp-vs-mount" aria-hidden="true" />

      {exportOpen && (
        <div className="gsp-overlay" role="dialog" aria-modal="true" aria-label={t('studio.exportTitle')}>
          <div className="gsp-modal gsp-vs-modal">
            <div className="gsp-vs-modal-head">
              <h3>{t('studio.exportTitle')}</h3>
              <button type="button" className="gsp-side-close" onClick={() => setExportOpen(false)} aria-label={t('common.close')}>
                <CloseIcon />
              </button>
            </div>
            <p>{t('studio.exportHint')}</p>

            <div className="gsp-vs-modal-section">
              <label className="gsp-vs-modal-label">{t('export.resolution')}</label>
              <div className="gsp-seg gsp-vs-seg">
                {(['720', '1080', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={exportSettings.resolution === mode ? 'is-on' : ''}
                    onClick={() => setExportSettings((current) => ({ ...current, resolution: mode }))}
                  >
                    {mode === 'custom' ? t('export.custom') : `${mode}p`}
                  </button>
                ))}
              </div>
              {exportSettings.resolution !== 'custom' ? (
                <div className="gsp-vs-resolution-readout">
                  <strong>{outputFrame.width} × {outputFrame.height}</strong>
                  <span>{t('studio.aspect')} {props.studio.aspect}</span>
                </div>
              ) : (
                <>
                  <div className="gsp-vs-custom-size">
                    <label>
                      <span>{t('export.width')}</span>
                      <input
                        className="gsp-input"
                        type="number"
                        min={240}
                        max={4096}
                        step={2}
                        value={exportSettings.customWidth}
                        onChange={(event) => updateCustom('width', Number(event.target.value))}
                      />
                    </label>
                    <span className="gsp-vs-times">×</span>
                    <label>
                      <span>{t('export.height')}</span>
                      <input
                        className="gsp-input"
                        type="number"
                        min={240}
                        max={4096}
                        step={2}
                        value={exportSettings.customHeight}
                        onChange={(event) => updateCustom('height', Number(event.target.value))}
                      />
                    </label>
                  </div>
                  <p className={`gsp-hint ${customMatchesAspect ? '' : 'is-warning'}`}>
                    {customMatchesAspect ? t('export.ratioLocked') : t('export.ratioMismatch')}
                  </p>
                </>
              )}
            </div>

            <div className="gsp-vs-modal-section">
              <label className="gsp-vs-modal-label" htmlFor="gsp-vs-fps">{t('export.fps')}</label>
              <select
                id="gsp-vs-fps"
                className="gsp-select"
                value={exportSettings.fps}
                onChange={(event) => setExportSettings((current) => ({ ...current, fps: Number(event.target.value) }))}
              >
                {FPS_OPTIONS.map((fps) => (
                  <option key={fps} value={fps}>{fps} fps</option>
                ))}
              </select>
            </div>

            <div className="gsp-vs-modal-section">
              <label className="gsp-vs-modal-label">{t('export.container')}</label>
              <div className="gsp-seg gsp-vs-seg">
                {(['webm', 'mp4'] as ExportContainer[]).map((container) => (
                  <button
                    key={container}
                    type="button"
                    className={exportSettings.container === container ? 'is-on' : ''}
                    onClick={() => setExportSettings((current) => (
                      VIDEO_CODECS_BY_CONTAINER[container].includes(current.videoCodec)
                        ? { ...current, container }
                        : { ...current, container, videoCodec: DEFAULT_VIDEO_CODEC[container] }
                    ))}
                  >
                    {container === 'webm' ? 'WebM' : 'MP4'}
                  </button>
                ))}
              </div>

              <label className="gsp-vs-modal-label" htmlFor="gsp-vs-codec">{t('export.videoCodec')}</label>
              <select
                id="gsp-vs-codec"
                className="gsp-select"
                value={exportSettings.videoCodec}
                onChange={(event) => setExportSettings((current) => ({ ...current, videoCodec: event.target.value as ExportVideoCodec }))}
              >
                {VIDEO_CODECS_BY_CONTAINER[exportSettings.container].map((codec) => (
                  <option
                    key={codec}
                    value={codec}
                    disabled={codecSupport[codec] === false}
                  >
                    {codec === 'avc' ? 'H.264' : codec.toUpperCase()}
                    {codecSupport[codec] === false ? ` — ${t('export.notSupported')}` : ''}
                  </option>
                ))}
              </select>

              <label className="gsp-vs-modal-label" htmlFor="gsp-vs-quality">{t('export.quality')}</label>
              <select
                id="gsp-vs-quality"
                className="gsp-select"
                value={exportSettings.quality}
                onChange={(event) => setExportSettings((current) => ({ ...current, quality: event.target.value as ExportQuality }))}
              >
                {(['low', 'normal', 'high'] as ExportQuality[]).map((quality) => (
                  <option key={quality} value={quality}>
                    {t(`export.quality.${quality}`)} ({(estimateVideoBitrate(outputFrame.width, outputFrame.height, exportSettings.fps, quality) / 1_000_000).toFixed(1)} Mbps)
                  </option>
                ))}
              </select>
              <p className="gsp-hint">{t('export.qualityHint')}</p>
            </div>

            <label className="gsp-check gsp-vs-audio-check">
              <input
                type="checkbox"
                checked={exportSettings.includeAudio}
                onChange={(event) => setExportSettings((current) => ({ ...current, includeAudio: event.target.checked }))}
              />
              {t('export.includeAudio')}
            </label>
            <p className="gsp-hint">
              {props.audioSource
                ? props.external
                  ? t('export.audioExternal')
                  : t('export.audioEmbedded')
                : t('export.noAudioTrack')}
            </p>
            <p className="gsp-hint">{t('export.note')}</p>
            {exportError && <div className="gsp-vs-modal-error">{exportError}</div>}

            <div className="gsp-modal-actions">
              <button type="button" className="gsp-btn" onClick={() => setExportOpen(false)}>{t('export.cancel')}</button>
              <button
                type="button"
                className="gsp-btn is-primary"
                onClick={() => { void startExport(); }}
                disabled={
                  !props.exportCodecSupported
                  || scoreLoading
                  || !!scoreError
                  || !previewScore
                  || (exportSettings.resolution === 'custom' && !customMatchesAspect)
                }
              >
                <ExportIcon /> {t('export.start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
