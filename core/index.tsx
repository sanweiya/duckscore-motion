import type * as React from 'react';
import * as alphaTab from '@coderline/alphatab';
import { CSS } from './styles';
import { BRAVURA_WOFF2_BASE64 } from './bravura';
import { applyFontOverrides, secondaryVoiceColor, scoreColor, FONT_KEYS, type FontKey, type FontOverride } from './score-style';
import { ReactRuntime } from './runtime';
import { VideoStudio } from './video-studio';
import {
  defaultPlayerLayout,
  spacingRatioFor,
  type AspectRatio,
  type ExternalMedia,
  type LayoutMode,
  type LayoutSettings,
  type MediaKind,
  type NotationSettings,
  type ScoreInfo,
  type StudioSettings,
  type TrackInfo,
  type Translate,
} from './studio-types';
import type { OfflineAudioSource } from './offline-export';
import { loadPlayerLayout, loadStudioState, savePlayerLayout, saveStudioState, type StoredStudioState } from './studio-storage';

declare global {
  interface Window {
    __ModuleLoader__: {
      load(registration: {
        id: string;
        factory(require: (id: string) => unknown): Record<string, unknown>;
      }): void;
    };
  }
}

/** Where the alphaTab runtime, SMuFL fonts and the soundfont live. */
export interface AssetLocations {
  assetBase: string;
  scriptFile: string;
  fontDirectory: string;
  soundfont: string;
}

function assetLocationsFor(base: string): AssetLocations {
  return {
    assetBase: base,
    scriptFile: `${base}alphaTab.worker.js`,
    fontDirectory: `${base}font/`,
    soundfont: `${base}soundfont/sonivox.sf2`,
  };
}

// The DSH plugin serves the assets from its own route. A standalone shell calls
// configureAssets() before mounting to point them at its static directory.
let assets = assetLocationsFor(`${window.location.origin}/plugins/gp-score-player/assets/`);

export function configureAssets(baseOrLocations: string | Partial<AssetLocations>): void {
  if (typeof baseOrLocations === 'string') {
    assets = assetLocationsFor(baseOrLocations);
    return;
  }
  const base = baseOrLocations.assetBase ?? assets.assetBase;
  assets = {
    assetBase: base,
    scriptFile: baseOrLocations.scriptFile ?? `${base}alphaTab.worker.js`,
    fontDirectory: baseOrLocations.fontDirectory ?? `${base}font/`,
    soundfont: baseOrLocations.soundfont ?? `${base}soundfont/sonivox.sf2`,
  };
}
const MAX_SCORE_BYTES = 100 * 1024 * 1024;

type Panel = 'settings' | 'tracks' | 'audio' | null;

interface ExternalMediaOutput {
  handler: ExternalMediaHandler | null;
  updatePosition?: (timeMs: number) => void;
}

interface ExternalMediaHandler {
  backingTrackDuration: number;
  playbackRate: number;
  masterVolume: number;
  seekTo(time: number): void;
  play(): void;
  pause(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface EmbeddedAudioInfo {
  offsetSec: number;
  syncPoints: { audioMs: number; scoreMs: number }[];
}

function embeddedAudioInfo(score: any): EmbeddedAudioInfo {
  try {
    const points = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score);
    if (!points.length) return { offsetSec: 0, syncPoints: [] };
    const sorted = points.slice().sort((a, b) => a.syncTime - b.syncTime);
    return {
      offsetSec: Math.max(0, (sorted[0].syncTime || 0) / 1000),
      syncPoints: sorted.map((point) => ({ audioMs: point.syncTime, scoreMs: point.synthTime })),
    };
  } catch {
    return { offsetSec: 0, syncPoints: [] };
  }
}

function isScoreFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return /\.(gp|gp3|gp4|gp5|gpx|gp7|gp8|musicxml|mxl|xml)$/.test(name);
}

function Icon(props: { children: React.ReactNode; size?: number; viewBox?: string }): React.ReactElement {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox={props.viewBox ?? '0 0 20 20'}
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

const PlayIcon = () => <Icon><path d="M6 4.5 15 10l-9 5.5z" fill="currentColor" stroke="none" /></Icon>;
const PauseIcon = () => <Icon><path d="M6.5 4.5v11M13.5 4.5v11" /></Icon>;
const StopIcon = () => <Icon><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></Icon>;
const FolderIcon = () => <Icon><path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h6A1.5 1.5 0 0 1 16.5 8.5v5A1.5 1.5 0 0 1 15 15H4.5A1.5 1.5 0 0 1 3 13.5z" /></Icon>;
const SlidersIcon = () => <Icon><path d="M4 6h6M14 6h2M4 14h2M10 14h6" /><circle cx="12" cy="6" r="2" /><circle cx="8" cy="14" r="2" /></Icon>;
const AudioIcon = () => <Icon><path d="M4 8v4h3l4 3V5L7 8z" /><path d="M14 7.5a3.5 3.5 0 0 1 0 5M16 5.5a6.5 6.5 0 0 1 0 9" /></Icon>;
const VideoIcon = () => <Icon><rect x="3" y="5" width="10" height="10" rx="2" /><path d="m13 8 4-2v8l-4-2" /></Icon>;
const VolumeIcon = ({ muted }: { muted?: boolean }) => (
  <Icon>
    <path d="M4 8v4h3l4 3V5L7 8z" />
    {muted ? <path d="m14 8 4 4m0-4-4 4" /> : <path d="M14 7.5a3.5 3.5 0 0 1 0 5" />}
  </Icon>
);
const MetronomeIcon = () => <Icon><path d="M7 3.5h6l2.2 13H4.8zM10 3.5v13M8 10.5l4-4" /></Icon>;
const LoopIcon = () => <Icon><path d="M4 8a3 3 0 0 1 3-3h7l-2-2M16 12a3 3 0 0 1-3 3H6l2 2" /></Icon>;
const CloseIcon = () => <Icon><path d="m5 5 10 10M15 5 5 15" /></Icon>;
const SettingsIcon = () => (
  <Icon>
    <g transform="scale(0.8333)" strokeWidth="2.04">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  </Icon>
);
const TracksIcon = () => (
  <Icon>
    <path d="M4 5.5h12M4 10h12M4 14.5h12" />
    <circle cx="6.3" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="6.3" cy="10" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="6.3" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);
const DownloadIcon = () => <Icon><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" /></Icon>;
const MusicIcon = () => <Icon size={24}><path d="M8 4v9.2a2.6 2.6 0 1 1-1.6-2.4M8 4l7-1.5v9.7a2.6 2.6 0 1 1-1.6-2.4" /></Icon>;
const TrashIcon = () => <Icon><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6M8.5 9v4M11.5 9v4" /></Icon>;
const ChevronIcon = ({ open }: { open?: boolean }) => (
  <Icon size={12}>
    <path d={open ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'} />
  </Icon>
);

export const ScoreGuideIcon = (props: { size?: number }): React.ReactElement => (
  <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <rect x="2.2" y="2.2" width="15.6" height="15.6" rx="4.2" fill="#171a20" />
    <path d="M5.4 7h9.2M5.4 10h9.2M5.4 13h9.2" stroke="#f3e9d2" strokeWidth="1.1" strokeLinecap="round" opacity=".7" />
    <circle cx="13" cy="7" r="2" fill="#ffb547" />
    <path d="M13 7v5" stroke="#ffb547" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

export function Player(props: { t?: Translate }): React.ReactElement {
  const { useState, useEffect, useRef, useCallback, useMemo } = ReactRuntime;
  const t = (props.t ?? ((key: string) => key)) as Translate;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const alphaHostRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const loadTokenRef = useRef(0);
  const fileTokenRef = useRef(0);
  const renderTimerRef = useRef(0);
  // The pending "render timeout" guard of the live api, so superseded loads do
  // not leave a dangling 20 s timer behind.
  const renderGuardRef = useRef(0);
  const mountedRef = useRef(true);
  const storedStudioRef = useRef<StoredStudioState | null>(null);
  if (storedStudioRef.current === null) storedStudioRef.current = loadStudioState();
  const initialStudioState = storedStudioRef.current;
  // The basic preview and the video studio keep separate layout memories: a
  // video designed in the studio must never reshape the player afterwards.
  const storedPlayerLayoutRef = useRef<LayoutSettings | null>(null);
  if (storedPlayerLayoutRef.current === null) storedPlayerLayoutRef.current = loadPlayerLayout();
  const initialPlayerLayout = storedPlayerLayoutRef.current;
  const externalRef = useRef<ExternalMedia | null>(null);
  const trackIndexRef = useRef(0);
  const playerLayoutRef = useRef<LayoutSettings>(initialPlayerLayout);
  const barWidthsRef = useRef<Record<number, number>>({});
  const barWidthBasesRef = useRef<Map<number, number> | null>(null);
  const manualSystemsRef = useRef(false);
  const notationRef = useRef<NotationSettings>({ standard: true, tab: true });
  const notationTouchedRef = useRef(false);
  const speedRef = useRef(1);
  const volumeRef = useRef(0.8);
  const metronomeRef = useRef(false);
  const countInRef = useRef(false);
  const loopRef = useRef(false);
  const playingRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const mediaPumpRef = useRef(0);
  const lastUiRef = useRef(0);
  const toastTimerRef = useRef(0);

  const [status, setStatus] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [meta, setMeta] = useState<ScoreInfo | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [, setTracksVersion] = useState(0);
  const [notation, setNotation] = useState<NotationSettings>({ standard: true, tab: true });
  const [playerLayout, setPlayerLayout] = useState<LayoutSettings>(initialPlayerLayout);
  // Studio layout is a separate, independently persisted state. The workbench
  // renders its own alphaTab instance, so it never needs the live player api.
  const [studioLayout, setStudioLayout] = useState<LayoutSettings>(initialStudioState.layout);
  const [fontKey, setFontKey] = useState<FontKey>('title');
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.8);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  // Brand mark for the empty state. It is a static file next to the assets
  // (`brand/logo.svg`), so it resolves under any deploy sub-path; hosts that do
  // not ship it simply keep the built-in note icon via `onError`.
  const brandLogoUrl = (() => {
    try {
      return new URL('../brand/logo.svg', assets.assetBase).href;
    } catch {
      return '';
    }
  })();
  const [brandLogoFailed, setBrandLogoFailed] = useState(false);
  const [external, setExternal] = useState<ExternalMedia | null>(null);
  const [offsetSec, setOffsetSec] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [view, setView] = useState<'player' | 'studio'>('player');
  const [studio, setStudio] = useState<StudioSettings>(initialStudioState.studio);
  const [barWidths, setBarWidths] = useState<Record<number, number>>({});
  const [barWidthTarget, setBarWidthTarget] = useState(1);
  const [toast, setToast] = useState<{ kind: 'info' | 'error' | 'success'; text: string } | null>(null);
  const [exportCodecSupported] = useState(
    () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window,
  );

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { metronomeRef.current = metronome; }, [metronome]);
  useEffect(() => { countInRef.current = countIn; }, [countIn]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { trackIndexRef.current = trackIndex; }, [trackIndex]);
  useEffect(() => { saveStudioState({ studio, layout: studioLayout }); }, [studio, studioLayout]);
  useEffect(() => { savePlayerLayout(playerLayout); }, [playerLayout]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadTokenRef.current++;
      fileTokenRef.current++;
      if (renderTimerRef.current) window.clearTimeout(renderTimerRef.current);
      if (mediaPumpRef.current) window.clearInterval(mediaPumpRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      const api = apiRef.current;
      apiRef.current = null;
      if (api) {
        try { api.destroy(); } catch { /* ignore */ }
      }
      const media = mediaRef.current;
      if (media) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
      const mediaUrl = externalRef.current?.url;
      externalRef.current = null;
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 5200);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  const notify = useCallback((kind: 'info' | 'error' | 'success', text: string) => {
    setToast({ kind, text });
  }, []);

  const destroyApi = useCallback(() => {
    const api = apiRef.current;
    apiRef.current = null;
    if (api) {
      try { api.destroy(); } catch { /* ignore */ }
    }
    if (alphaHostRef.current) alphaHostRef.current.innerHTML = '';
    window.clearTimeout(renderGuardRef.current);
    renderGuardRef.current = 0;
    setPlayerReady(false);
    setPlaying(false);
  }, []);

  const settingsFor = useCallback((externalMode: boolean): any => {
    const current = playerLayoutRef.current;
    const mode = current.mode === 'horizontal'
      ? alphaTab.LayoutMode.Horizontal
      : alphaTab.LayoutMode.Page;
    return {
      core: {
        scriptFile: assets.scriptFile,
        fontDirectory: assets.fontDirectory,
        useWorkers: false,
        enableLazyLoading: false,
        logLevel: alphaTab.LogLevel.Warning,
        smuflFontSources: new Map([[alphaTab.FontFileFormat.Woff2, `data:font/woff2;base64,${BRAVURA_WOFF2_BASE64}`]]),
      },
      display: {
        layoutMode: mode,
        scale: current.scale,
        stretchForce: current.stretch,
        spacingRatio: spacingRatioFor(current.stretch),
        barsPerRow: current.barsPerRow,
        padding: [18, 22],
        resources: {
          mainGlyphColor: current.colors.main,
          secondaryGlyphColor: secondaryVoiceColor(current.voice2, current.colors.main).rgba,
          staffLineColor: current.colors.staff,
          barSeparatorColor: current.colors.bar,
          barNumberColor: current.colors.barNumber,
          scoreInfoColor: current.colors.info,
        },
      },
      player: {
        playerMode: externalMode ? alphaTab.PlayerMode.EnabledExternalMedia : alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: externalMode ? null : assets.soundfont,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        outputMode: alphaTab.PlayerOutputMode.WebAudioScriptProcessor,
        scrollElement: scrollRef.current ?? 'html,body',
        // alphaTab's ScriptProcessor output pulls 4096 frames (8192 interleaved
        // samples) per callback but only keeps half the configured buffer in
        // flight. Anything below four buffers (~342 ms at 48 kHz) leaves every
        // callback half empty: the synth then plays at 0.5x with constant
        // crackle, because the reported time position only advances with the
        // samples that were actually there. Keep alphaTab's own default (500 ms)
        // and never go under 350.
        bufferTimeInMilliseconds: 500,
      },
    };
  }, []);

  const mediaOutput = useCallback((): ExternalMediaOutput | null => {
    const api = apiRef.current;
    const player = api?.player;
    if (!player) return null;
    const output = player.output as unknown as ExternalMediaOutput;
    return output ?? null;
  }, []);

  const pushMediaPosition = useCallback(() => {
    const api = apiRef.current;
    const media = mediaRef.current;
    if (!api || !media || !externalRef.current) return;
    const output = mediaOutput();
    if (!output || typeof output.updatePosition !== 'function' || !Number.isFinite(media.currentTime)) return;
    output.updatePosition((media.currentTime / (media.playbackRate || 1)) * 1000);
  }, [mediaOutput]);

  const startMediaPump = useCallback(() => {
    if (mediaPumpRef.current) window.clearInterval(mediaPumpRef.current);
    mediaPumpRef.current = window.setInterval(pushMediaPosition, 50);
  }, [pushMediaPosition]);

  const stopMediaPump = useCallback(() => {
    if (mediaPumpRef.current) window.clearInterval(mediaPumpRef.current);
    mediaPumpRef.current = 0;
  }, []);

  const attachExternalHandler = useCallback((api: alphaTab.AlphaTabApi) => {
    const media = mediaRef.current;
    const externalMedia = externalRef.current;
    if (!media || !externalMedia) return;
    const output = mediaOutput();
    if (!output) return;
    media.playbackRate = speedRef.current;
    media.volume = volumeRef.current;
    const handler: ExternalMediaHandler = {
      get backingTrackDuration() {
        return Number.isFinite(media.duration) ? media.duration * 1000 : 0;
      },
      get playbackRate() {
        return media.playbackRate;
      },
      set playbackRate(value: number) {
        media.playbackRate = clamp(value, 0.25, 3);
      },
      get masterVolume() {
        return media.volume;
      },
      set masterVolume(value: number) {
        media.volume = clamp(value, 0, 1);
      },
      seekTo(time: number) {
        const target = Math.max(0, (time * media.playbackRate) / 1000);
        const bounded = Number.isFinite(media.duration) && media.duration > 0 ? Math.min(media.duration, target) : target;
        try { media.currentTime = bounded; } catch { /* ignore */ }
      },
      play() {
        void media.play().catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          setError(`${t('player.mediaFailed')} ${message}`);
          notify('error', t('player.mediaFailed'));
        });
      },
      pause() {
        media.pause();
      },
    };
    output.handler = handler;
    if (media.readyState < 1) {
      media.addEventListener('loadedmetadata', () => {
        if (!externalRef.current) return;
        try { api.timePosition = api.timePosition; } catch { /* ignore */ }
      }, { once: true });
    }
  }, [mediaOutput, notify, t]);

  const applyExternalSync = useCallback((api: alphaTab.AlphaTabApi) => {
    const score = api.score;
    const player = api.player;
    const externalMedia = externalRef.current;
    if (!score || !player || !externalMedia) return;
    try {
      const points = alphaTab.midi.MidiFileGenerator.generateSyncPoints(score, true);
      const offset = Math.max(0, externalMedia.offsetSec) * 1000;
      for (const point of points) {
        point.syncTime = Math.max(0, point.syncTime + offset);
      }
      player.updateSyncPoints(points);
      player.playbackSpeed = speedRef.current;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(`${t('sync.failed')} ${message}`);
    }
  }, [t]);

  const bindApi = useCallback((api: alphaTab.AlphaTabApi, token: number) => {
    let positionAttached = false;
    let renderSettled = false;
    window.clearTimeout(renderGuardRef.current);
    renderGuardRef.current = window.setTimeout(() => {
      if (token !== loadTokenRef.current || !mountedRef.current || renderSettled) return;
      setError(t('error.renderTimeout'));
      setStatus('error');
    }, 20_000);
    const scheduleExternalSync = () => {
      let attempts = 0;
      const attempt = () => {
        if (token !== loadTokenRef.current || !mountedRef.current || !externalRef.current) return;
        const player = api.player;
        if (player && (player.loadedMidiInfo || player.isReadyForPlayback)) {
          applyExternalSync(api);
          return;
        }
        if (++attempts < 30) window.setTimeout(attempt, 100);
        else console.warn('[gp-studio] external media readiness not detected within 3 s; sync re-applies on readiness events');
      };
      window.setTimeout(attempt, 0);
    };
    api.scoreLoaded.on((score) => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      const tracks: TrackInfo[] = score.tracks.map((track) => ({
        index: track.index,
        name: track.name || `${t('common.track')} ${track.index + 1}`,
      }));
      const index = clamp(trackIndexRef.current, 0, Math.max(0, tracks.length - 1));
      trackIndexRef.current = index;
      setTrackIndex(index);
      const track = score.tracks.find((candidate) => candidate.index === index);
      const staff = track?.staves?.[0];
      const flags: NotationSettings = notationTouchedRef.current
        ? notationRef.current
        : {
            standard: staff ? staff.showStandardNotation : true,
            tab: staff ? staff.showTablature : true,
          };
      if (!flags.standard && !flags.tab) flags.tab = true;
      notationRef.current = flags;
      setNotation(flags);
      if (track) {
        for (const item of track.staves) {
          item.showStandardNotation = flags.standard;
          item.showTablature = flags.tab;
        }
      }
      setBarWidthTarget((current) => clamp(current, 1, Math.max(1, score.masterBars.length)));
      setMeta({
        title: score.title || '',
        artist: score.artist || '',
        album: score.album || '',
        tempo: score.tempo || 0,
        tracks,
        hasBackingTrack: !!score.backingTrack,
        bars: score.masterBars.length,
        barLabels: score.masterBars.map((bar: any) => {
          const number = Number(bar.barNumber);
          const text = String(bar.barNumberText ?? '');
          return {
            label: text || (Number.isFinite(number) ? String(number) : ''),
            pickup: !!bar.isAnacrusis,
          };
        }),
      });
      setDuration(api.endTime || 0);
      durationRef.current = api.endTime || 0;
      hostRef.current?.focus({ preventScroll: true });
      if (externalRef.current) window.setTimeout(() => applyExternalSync(api), 0);
    });

    api.beatMouseDown.on((beat: any) => {
      const barIndex = beat?.voice?.bar?.index;
      if (Number.isInteger(barIndex)) setBarWidthTarget(Math.max(1, barIndex + 1));
    });

    api.postRenderFinished.on(() => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      renderSettled = true;
      window.clearTimeout(renderGuardRef.current);
      setStatus('ready');
      setDuration(api.endTime || 0);
      durationRef.current = api.endTime || 0;
    });

    api.playerReady.on(() => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      setPlayerReady(true);
      if (!positionAttached) {
        positionAttached = true;
        api.player?.positionChanged.on((args) => {
          if (token !== loadTokenRef.current || !mountedRef.current) return;
          positionRef.current = args.currentTime;
          if (args.endTime > 0) durationRef.current = args.endTime;
          const now = Date.now();
          if (args.isSeek || now - lastUiRef.current > 80) {
            lastUiRef.current = now;
            setPosition(args.currentTime);
            setDuration(args.endTime || durationRef.current);
          }
        });
      }
      api.masterVolume = volumeRef.current;
      api.playbackSpeed = speedRef.current;
      if (externalRef.current) {
        api.metronomeVolume = 0;
        api.countInVolume = 0;
      } else {
        api.metronomeVolume = metronomeRef.current ? 1 : 0;
        api.countInVolume = countInRef.current ? 1 : 0;
      }
      api.isLooping = loopRef.current;
      setDuration(api.endTime || 0);
      durationRef.current = api.endTime || 0;
      if (externalRef.current) {
        attachExternalHandler(api);
        scheduleExternalSync();
        api.player?.midiLoaded.on(() => {
          if (token !== loadTokenRef.current || !mountedRef.current) return;
          attachExternalHandler(api);
          // alphaTab writes the generated sync points after midiLoaded fires;
          // re-apply on the next task so the external timing is not overwritten.
          window.setTimeout(() => {
            if (token !== loadTokenRef.current || !mountedRef.current) return;
            applyExternalSync(api);
          }, 0);
        });
        api.player?.readyForPlayback.on(() => {
          if (token !== loadTokenRef.current || !mountedRef.current) return;
          attachExternalHandler(api);
          window.setTimeout(() => {
            if (token !== loadTokenRef.current || !mountedRef.current) return;
            applyExternalSync(api);
          }, 0);
        });
      }
    });

    api.playerStateChanged.on((args) => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      const isPlaying = args.state === alphaTab.synth.PlayerState.Playing;
      setPlaying(isPlaying);
      if (!isPlaying) {
        stopMediaPump();
        if (externalRef.current) pushMediaPosition();
      } else if (externalRef.current) {
        startMediaPump();
      }
    });

    api.playerFinished.on(() => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      setPlaying(false);
      stopMediaPump();
      positionRef.current = api.endTime || 0;
      setPosition(api.endTime || 0);
    });

    api.error.on((reason) => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      renderSettled = true;
      window.clearTimeout(renderGuardRef.current);
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      if (!api.score) setStatus('error');
    });
  }, [applyExternalSync, attachExternalHandler, pushMediaPosition, startMediaPump, stopMediaPump, t]);

  const buildApi = useCallback((externalMode: boolean) => {
    const token = ++loadTokenRef.current;
    destroyApi();
    setError('');
    setStatus('loading');
    setPosition(0);
    positionRef.current = 0;
    setDuration(0);
    durationRef.current = 0;
    let containerAttempts = 0;
    const buildInFrame = () => {
      if (token !== loadTokenRef.current || !mountedRef.current) return;
      const container = alphaHostRef.current;
      const bytes = bytesRef.current;
      if (!container) {
        // The score container only exists once React commits the 'loading'
        // status. If this frame ran before that commit, retry instead of
        // giving up silently (which would leave the spinner forever).
        if (++containerAttempts > 120) {
          setError(t('file.loadFailed'));
          setStatus('error');
          return;
        }
        window.requestAnimationFrame(buildInFrame);
        return;
      }
      if (!bytes) return;
      container.innerHTML = '';
      let api: alphaTab.AlphaTabApi;
      try {
        api = new alphaTab.AlphaTabApi(container, settingsFor(externalMode));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setStatus('error');
        return;
      }
      apiRef.current = api;
      applyFontOverrides(api, playerLayoutRef.current.fonts);
      bindApi(api, token);
      let loaded = false;
      try {
        loaded = api.load(bytes, [trackIndexRef.current]);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        setStatus('error');
        return;
      }
      if (!loaded) {
        setError(t('file.loadFailed'));
        setStatus('error');
      }
    };
    window.requestAnimationFrame(buildInFrame);
  }, [bindApi, destroyApi, settingsFor, t]);

  const scheduleRender = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (renderTimerRef.current) window.clearTimeout(renderTimerRef.current);
    renderTimerRef.current = window.setTimeout(() => {
      renderTimerRef.current = 0;
      try { api.render(); } catch { /* ignore */ }
    }, 120);
  }, []);

  const applyPlayerLayout = useCallback((next: LayoutSettings) => {
    playerLayoutRef.current = next;
    setPlayerLayout(next);
    const api = apiRef.current;
    if (!api) return;
    api.settings.display.layoutMode = next.mode === 'horizontal'
      ? alphaTab.LayoutMode.Horizontal
      : alphaTab.LayoutMode.Page;
    api.settings.display.scale = next.scale;
    api.settings.display.stretchForce = next.stretch;
    api.settings.display.spacingRatio = spacingRatioFor(next.stretch);
    api.settings.display.barsPerRow = next.barsPerRow;
    api.settings.display.resources.mainGlyphColor = scoreColor(next.colors.main);
    api.settings.display.resources.secondaryGlyphColor = secondaryVoiceColor(next.voice2, api.settings.display.resources.mainGlyphColor);
    api.settings.display.resources.staffLineColor = scoreColor(next.colors.staff);
    api.settings.display.resources.barSeparatorColor = scoreColor(next.colors.bar);
    api.settings.display.resources.barNumberColor = scoreColor(next.colors.barNumber);
    api.settings.display.resources.scoreInfoColor = scoreColor(next.colors.info);
    applyFontOverrides(api, next.fonts);
    api.updateSettings();
    scheduleRender();
  }, [scheduleRender]);

  // The studio owns a second alphaTab instance (built from the score bytes), so
  // its layout only has to update this state: the player's api and its render
  // stay untouched, and switching back to the player shows its own layout.
  const applyStudioLayout = useCallback((next: LayoutSettings) => {
    setStudioLayout(next);
  }, []);

  const applyBarWidths = useCallback((widths: Record<number, number>) => {
    barWidthsRef.current = widths;
    setBarWidths(widths);
    const api = apiRef.current;
    if (!api?.score) return;
    const score = api.score;
    const track = score.tracks.find((candidate: any) => candidate.index === trackIndexRef.current) ?? api.score.tracks[0];
    if (!track) return;

    const factorFor = (index: number) => {
      const value = widths[index + 1];
      return typeof value === 'number' ? clamp(value, 50, 200) / 100 : 1;
    };
    const hasWidths = Object.keys(widths).length > 0;
    const horizontal = playerLayoutRef.current.mode === 'horizontal';

    const resetPageOverrides = () => {
      for (const staff of track.staves) {
        for (const bar of staff.bars) bar.displayScale = 1;
      }
      for (const bar of score.masterBars) bar.displayScale = 1;
      api.settings.display.systemsLayoutMode = alphaTab.SystemsLayoutMode.Automatic;
      manualSystemsRef.current = false;
    };
    const resetHorizontalOverrides = () => {
      for (const staff of track.staves) {
        for (const bar of staff.bars) bar.displayWidth = -1;
      }
      for (const bar of score.masterBars) bar.displayWidth = -1;
      barWidthBasesRef.current = null;
    };

    if (!hasWidths) {
      resetPageOverrides();
      resetHorizontalOverrides();
      api.updateSettings();
      api.render();
      return;
    }

    if (horizontal) {
      if (manualSystemsRef.current) resetPageOverrides();
      if (!barWidthBasesRef.current) {
        const bases = new Map<number, number>();
        const displayScale = api.settings.display.scale || 1;
        for (const system of api.boundsLookup?.staffSystems ?? []) {
          for (const bar of system.bars) {
            bases.set(bar.index, bar.realBounds.w / displayScale);
          }
        }
        barWidthBasesRef.current = bases;
      }
      const bases = barWidthBasesRef.current;
      for (const staff of track.staves) {
        for (const bar of staff.bars) {
          const base = bases.get(bar.index);
          if (base && base > 0) bar.displayWidth = base * factorFor(bar.index);
        }
      }
      for (const bar of score.masterBars) {
        const base = bases.get(bar.index);
        if (base && base > 0) bar.displayWidth = base * factorFor(bar.index);
      }
      api.render();
      return;
    }

    if (barWidthBasesRef.current) resetHorizontalOverrides();
    if (!manualSystemsRef.current) {
      const systems = (api.boundsLookup?.staffSystems ?? []).map((system) => system.bars.length).filter((count) => count > 0);
      if (systems.length > 0) {
        track.systemsLayout = systems;
        track.defaultSystemsLayout = systems[0];
        api.settings.display.systemsLayoutMode = alphaTab.SystemsLayoutMode.UseModelLayout;
        manualSystemsRef.current = true;
      }
    }
    if (!manualSystemsRef.current) return;
    for (const staff of track.staves) {
      for (const bar of staff.bars) bar.displayScale = factorFor(bar.index);
    }
    for (const bar of score.masterBars) bar.displayScale = factorFor(bar.index);
    api.updateSettings();
    api.render();
  }, []);

  const changeBarWidth = useCallback((index: number, value: number) => {
    const next = { ...barWidthsRef.current };
    if (value === 100) delete next[index];
    else next[index] = value;
    applyBarWidths(next);
  }, [applyBarWidths]);

  const resetBarWidth = useCallback((index?: number) => {
    if (typeof index !== 'number') {
      applyBarWidths({});
      return;
    }
    const next = { ...barWidthsRef.current };
    delete next[index];
    applyBarWidths(next);
  }, [applyBarWidths]);

  const applyFont = useCallback((patch: Partial<FontOverride>) => {
    const current = playerLayoutRef.current;
    applyPlayerLayout({
      ...current,
      fonts: {
        ...current.fonts,
        [fontKey]: { ...current.fonts?.[fontKey], ...patch },
      },
    });
  }, [applyPlayerLayout, fontKey]);

  const applyNotation = useCallback((api: alphaTab.AlphaTabApi, index: number, flags: NotationSettings) => {
    const track = api.score?.tracks[index];
    if (!track) return;
    for (const staff of track.staves) {
      staff.showStandardNotation = flags.standard;
      staff.showTablature = flags.tab;
    }
  }, []);

  const changeNotation = useCallback((patch: Partial<NotationSettings>) => {
    notationTouchedRef.current = true;
    const api = apiRef.current;
    let next: NotationSettings = { ...notationRef.current, ...patch };
    if (!next.standard && !next.tab) {
      if (patch.standard === false) next.tab = true;
      else next.standard = true;
    }
    notationRef.current = next;
    setNotation(next);
    if (api) {
      applyNotation(api, trackIndexRef.current, next);
      scheduleRender();
    }
  }, [applyNotation, scheduleRender]);

  const changeTrack = useCallback((index: number) => {
    const api = apiRef.current;
    trackIndexRef.current = index;
    setTrackIndex(index);
    if (!api) return;
    applyNotation(api, index, notationRef.current);
    const track = api.score?.tracks.find((candidate) => candidate.index === index);
    if (track) {
      try {
        api.renderTracks([track]);
        setDuration(api.endTime || 0);
        durationRef.current = api.endTime || 0;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [applyNotation]);

  const toggleTrackMute = useCallback((index: number) => {
    const api = apiRef.current;
    const track = api?.score?.tracks.find((candidate) => candidate.index === index);
    if (!api || !track) return;
    track.playbackInfo.isMute = !track.playbackInfo.isMute;
    api.changeTrackMute([track], track.playbackInfo.isMute);
    setTracksVersion((version) => version + 1);
  }, []);

  const toggleTrackSolo = useCallback((index: number) => {
    const api = apiRef.current;
    const track = api?.score?.tracks.find((candidate) => candidate.index === index);
    if (!api || !track) return;
    track.playbackInfo.isSolo = !track.playbackInfo.isSolo;
    api.changeTrackSolo([track], track.playbackInfo.isSolo);
    setTracksVersion((version) => version + 1);
  }, []);

  const changeTrackLevel = useCallback((index: number, percent: number) => {
    const api = apiRef.current;
    const track = api?.score?.tracks.find((candidate) => candidate.index === index);
    if (!api || !track) return;
    const target = clamp(percent / 100, 0, 1);
    track.playbackInfo.volume = target;
    api.changeTrackVolume([track], target);
    setTracksVersion((version) => version + 1);
  }, []);

  const resetMedia = useCallback(() => {
    const media = mediaRef.current;
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    const current = externalRef.current;
    if (current) URL.revokeObjectURL(current.url);
    externalRef.current = null;
    setExternal(null);
    setOffsetSec(0);
    stopMediaPump();
  }, [stopMediaPump]);

  const loadFile = useCallback(async (file: File) => {
    if (!file) return;
    if (!isScoreFile(file)) {
      notify('error', t('file.badType'));
      return;
    }
    if (file.size > MAX_SCORE_BYTES) {
      notify('error', t('file.tooLarge'));
      return;
    }
    const token = ++fileTokenRef.current;
    stopMediaPump();
    if (renderTimerRef.current) window.clearTimeout(renderTimerRef.current);
    setView('player');
    setStatus('loading');
    setError('');
    setPanel(null);
    try {
      const buffer = await file.arrayBuffer();
      if (token !== fileTokenRef.current || !mountedRef.current) return;
      bytesRef.current = new Uint8Array(buffer);
      setFileName(file.name);
      setMeta(null);
      setDuration(0);
      durationRef.current = 0;
      setPosition(0);
      positionRef.current = 0;
      trackIndexRef.current = 0;
      setTrackIndex(0);
      barWidthsRef.current = {};
      setBarWidths({});
      setBarWidthTarget(1);
      barWidthBasesRef.current = null;
      manualSystemsRef.current = false;
      notationTouchedRef.current = false;
      resetMedia();
      buildApi(false);
      // Take focus back from the sidebar/file dialog so Space works immediately.
      hostRef.current?.focus({ preventScroll: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(`${t('file.readFailed')} ${message}`);
      setStatus('error');
    }
  }, [buildApi, notify, resetMedia, stopMediaPump, t]);

  const onFileInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    event.target.blur();
    if (file) void loadFile(file);
  }, [loadFile]);

  const onMediaInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    event.target.blur();
    if (!file) return;
    if (!bytesRef.current) {
      notify('error', t('audio.needScore'));
      return;
    }
    const media = mediaRef.current;
    if (!media) return;
    stopMediaPump();
    media.pause();
    const current = externalRef.current;
    if (current) URL.revokeObjectURL(current.url);
    const url = URL.createObjectURL(file);
    const kind: MediaKind = file.type.startsWith('video') ? 'video' : 'audio';
    const next: ExternalMedia = { name: file.name, kind, url, mime: file.type, offsetSec: 0 };
    externalRef.current = next;
    setExternal(next);
    setOffsetSec(0);
    media.src = url;
    media.load();
    setPanel(null);
    notify('info', t('toast.audioLoaded'));
    buildApi(true);
  }, [buildApi, notify, stopMediaPump, t]);

  const removeMedia = useCallback(() => {
    const api = apiRef.current;
    if (api) {
      try { api.pause(); } catch { /* ignore */ }
    }
    resetMedia();
    notify('info', t('toast.audioRemoved'));
    if (bytesRef.current) buildApi(false);
  }, [buildApi, notify, resetMedia, t]);

  const changeOffset = useCallback((value: number) => {
    const nextValue = clamp(Number.isFinite(value) ? value : 0, 0, 120);
    setOffsetSec(nextValue);
    const current = externalRef.current;
    if (!current) return;
    current.offsetSec = nextValue;
    setExternal({ ...current });
    const api = apiRef.current;
    if (!api || !api.player) return;
    const at = api.timePosition;
    applyExternalSync(api);
    try { api.timePosition = at; } catch { /* ignore */ }
  }, [applyExternalSync]);

  const togglePlay = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (api.playerState === alphaTab.synth.PlayerState.Playing) {
      api.pause();
      return;
    }
    if (api.endTime > 0 && api.timePosition >= api.endTime - 30 && !loopRef.current) {
      try { api.timePosition = 0; } catch { /* ignore */ }
    }
    if (!api.play()) {
      notify('info', t('player.notReady'));
    }
  }, [notify, t]);

  const stopPlayback = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    try { api.stop(); } catch { /* ignore */ }
    try { api.timePosition = 0; } catch { /* ignore */ }
    stopMediaPump();
    setPosition(0);
    positionRef.current = 0;
  }, [stopMediaPump]);

  const seek = useCallback((value: number) => {
    const api = apiRef.current;
    if (!api) return;
    const end = durationRef.current || api.endTime || 0;
    const target = clamp(Number.isFinite(value) ? value : 0, 0, end);
    try { api.timePosition = target; } catch { /* ignore */ }
    positionRef.current = target;
    setPosition(target);
    if (externalRef.current) window.setTimeout(pushMediaPosition, 0);
  }, [pushMediaPosition]);

  const changeSpeed = useCallback((value: number) => {
    setSpeed(value);
    const api = apiRef.current;
    if (api) api.playbackSpeed = value;
    const media = mediaRef.current;
    if (media) media.playbackRate = clamp(value, 0.25, 3);
  }, []);

  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    const api = apiRef.current;
    if (api) api.masterVolume = value;
    const media = mediaRef.current;
    if (media) media.volume = clamp(value, 0, 1);
  }, []);

  const changeMetronome = useCallback((value: boolean) => {
    setMetronome(value);
    metronomeRef.current = value;
    const api = apiRef.current;
    if (api) api.metronomeVolume = value ? 1 : 0;
  }, []);

  const changeCountIn = useCallback((value: boolean) => {
    setCountIn(value);
    countInRef.current = value;
    const api = apiRef.current;
    if (api) api.countInVolume = value ? 1 : 0;
  }, []);

  const changeLoop = useCallback((value: boolean) => {
    setLoop(value);
    loopRef.current = value;
    const api = apiRef.current;
    if (api) api.isLooping = value;
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (view === 'studio') return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      seek(positionRef.current - 5000);
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      seek(positionRef.current + 5000);
    } else if (event.code === 'Escape' && panel) {
      setPanel(null);
    }
  }, [panel, seek, view]);

  // Space is a playback shortcut even when a player button or slider has focus.
  // Text fields keep their native space behaviour.
  useEffect(() => {
    const onSpace = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const root = hostRef.current;
      const target = event.target as Node | null;
      if (!root || !root.isConnected || root.getClientRects().length === 0) return;
      const element = target instanceof HTMLElement ? target : document.body;
      if (element.isContentEditable) return;
      const tag = element.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'INPUT') {
        const type = (element as HTMLInputElement).type;
        if (type !== 'range' && type !== 'file') return;
      }
      if (view === 'studio') return;
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
    };
    // Capture phase: the host may stop keydown on its own chrome before it
    // bubbles back to the plugin, and focus can sit on the sidebar tab.
    window.addEventListener('keydown', onSpace, true);
    return () => window.removeEventListener('keydown', onSpace, true);
  }, [togglePlay, view]);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }, [loadFile]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (status === 'ready') scheduleRender();
      });
    });
    observer.observe(scroll);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scheduleRender, status]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onPlay = () => {
      if (externalRef.current) startMediaPump();
    };
    const onPause = () => {
      if (externalRef.current) {
        stopMediaPump();
        pushMediaPosition();
      }
    };
    const onSeeked = () => {
      if (externalRef.current) pushMediaPosition();
    };
    const onTimeUpdate = () => {
      if (externalRef.current && mediaPaused() === false) pushMediaPosition();
    };
    const onEnded = () => {
      stopMediaPump();
      const api = apiRef.current;
      if (!api) return;
      if (loopRef.current) {
        try {
          api.timePosition = 0;
          api.play();
        } catch { /* ignore */ }
        return;
      }
      if (api.playerState === alphaTab.synth.PlayerState.Playing) {
        try { api.stop(); } catch { /* ignore */ }
      }
    };
    const mediaPaused = () => media.paused;
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('timeupdate', onTimeUpdate);
    media.addEventListener('ended', onEnded);
    return () => {
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('ended', onEnded);
    };
  }, [pushMediaPosition, startMediaPump, stopMediaPump]);

  const effectiveDuration = duration || apiRef.current?.endTime || 0;
  const externalActive = !!external;
  const hasScore = status !== 'empty';
  const playerModeLabel = externalActive
    ? t('status.external')
    : meta?.hasBackingTrack
      ? t('status.embedded')
      : t('status.synth');
  const selectedFont = playerLayout.fonts?.[fontKey] ?? {};
  const scoreTitle = meta?.title || fileName || t('header.empty');
  const scoreArtist = meta?.artist || '';
  const progressPct = effectiveDuration > 0 ? clamp(position / effectiveDuration, 0, 1) * 100 : 0;

  const studioAudio = useMemo<OfflineAudioSource | null>(() => {
    if (external) return { url: external.url, offsetSec: external.offsetSec };
    const api = apiRef.current;
    const raw = api?.score?.backingTrack?.rawAudioFile as Uint8Array | undefined;
    if (!api?.score || !raw) return null;
    const info = embeddedAudioInfo(api.score);
    return { bytes: raw, offsetSec: info.offsetSec, syncPoints: info.syncPoints };
  }, [external, meta, status]);

  const openStudio = useCallback(() => {
    const api = apiRef.current;
    if (!api || !bytesRef.current) return;
    try { api.pause(); } catch { /* ignore */ }
    // Scores without a backing track never fire `playerReady` until playback
    // has started (the synthesizer needs an audio context). The MIDI timing
    // used by the video workbench only needs the tick lookup, which is built
    // synchronously here, so the studio opens without ever pressing play.
    try {
      if (!(api as any).tickCache) api.loadMidiForScore();
    } catch { /* the studio falls back to the score's own tempo */ }
    setPlaying(false);
    setPanel(null);
    setView('studio');
  }, []);

  const closeStudio = useCallback(() => {
    setView('player');
    window.requestAnimationFrame(() => hostRef.current?.focus({ preventScroll: true }));
  }, []);

  return (
    <div
      className={`gsp-root ${view === 'studio' ? 'is-studio' : ''}`}
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={onDrop}
    >
      <style>{CSS}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.musicxml,.mxl,.xml"
        className="gsp-sr-only"
        onChange={onFileInput}
        aria-label={t('open.title')}
      />
      <input
        ref={mediaInputRef}
        type="file"
        accept="audio/*,video/*"
        className="gsp-sr-only"
        onChange={onMediaInput}
        aria-label={t('audio.load')}
      />

      <div className={`gsp-stage ${dragActive ? 'is-drag' : ''}`}>
        {error && <div className="gsp-error">{error}</div>}

        <div className="gsp-score-scroll" ref={scrollRef}>
          {!hasScore ? (
            <div className={`gsp-empty ${dragActive ? 'is-drag' : ''}`}>
              {brandLogoUrl && !brandLogoFailed ? (
                <div className="gsp-empty-icon has-logo">
                  <img
                    src={brandLogoUrl}
                    alt=""
                    draggable={false}
                    onError={() => setBrandLogoFailed(true)}
                  />
                </div>
              ) : (
                <div className="gsp-empty-icon"><MusicIcon /></div>
              )}
              <h3>{dragActive ? t('empty.drag') : t('empty.title')}</h3>
              <p>{t('empty.hint')}</p>
              <div className="gsp-empty-actions">
                <button type="button" className="gsp-btn is-primary" onClick={() => fileInputRef.current?.click()}>
                  <FolderIcon /> {t('empty.open')}
                </button>
              </div>
              <span className="gsp-chip">{t('empty.formats')}</span>
            </div>
          ) : (
            <div className="gsp-score-pad">
              <div className="gsp-alpha" ref={alphaHostRef} />
            </div>
          )}
          {status === 'loading' && (
            <div className="gsp-loading">
              <span className="gsp-spinner" />
              {t('status.loading')}
            </div>
          )}
          {dragActive && hasScore && (
            <div className="gsp-loading" style={{ background: 'var(--gsp-accent-soft)' }}>{t('empty.drag')}</div>
          )}
        </div>

        {panel === 'settings' && (
          <aside className="gsp-side" aria-label={t('settings.title')}>
            <div className="gsp-side-head">
              <h3>{t('settings.title')}</h3>
              <button type="button" className="gsp-side-close" onClick={() => setPanel(null)} aria-label={t('common.close')}>
                <CloseIcon />
              </button>
            </div>
            <div className="gsp-side-body">
              <section className="gsp-group">
                <h4>{t('layout.title')}</h4>
                <div className="gsp-field">
                  <label htmlFor="gsp-mode">{t('layout.mode')}</label>
                  <select
                    id="gsp-mode"
                    className="gsp-select"
                    value={playerLayout.mode}
                    onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, mode: event.target.value as LayoutMode })}
                  >
                    {/* Single-line framing is a video-workbench framing, so the
                        player only offers the two layouts it can actually show. */}
                    {(['page', 'horizontal'] as LayoutMode[]).map((mode) => (
                      <option key={mode} value={mode}>{t(`layout.${mode}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-scale">{t('layout.scale')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-scale"
                      type="range"
                      min={25}
                      max={400}
                      step={5}
                      value={Math.round(playerLayout.scale * 100)}
                      onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, scale: Number(event.target.value) / 100 })}
                    />
                    <span className="gsp-value">{Math.round(playerLayout.scale * 100)}%</span>
                  </div>
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-stretch">{t('layout.stretch')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-stretch"
                      type="range"
                      min={20}
                      max={200}
                      step={5}
                      value={Math.round(playerLayout.stretch * 100)}
                      onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, stretch: Number(event.target.value) / 100 })}
                    />
                    <span className="gsp-value">{Math.round(playerLayout.stretch * 100)}%</span>
                  </div>
                </div>
                <p className="gsp-hint">{t('layout.stretchHint')}</p>
                <div className="gsp-field">
                  <label htmlFor="gsp-bars">{t('layout.barsPerRow')}</label>
                  <select
                    id="gsp-bars"
                    className="gsp-select"
                    value={playerLayout.barsPerRow}
                    onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, barsPerRow: Number(event.target.value) })}
                    disabled={playerLayout.mode === 'horizontal'}
                  >
                    <option value={-1}>{t('layout.auto')}</option>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-voice2" title={t('layout.voice2Hint')}>{t('layout.voice2')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-voice2"
                      type="range"
                      min={20}
                      max={100}
                      step={5}
                      value={playerLayout.voice2}
                      onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, voice2: Number(event.target.value) })}
                    />
                    <span className="gsp-value">{playerLayout.voice2}%</span>
                  </div>
                </div>
                <div className="gsp-field">
                  <label>{t('layout.notation')}</label>
                  <div className="gsp-inline">
                    <label className="gsp-check">
                      <input type="checkbox" checked={notation.standard} onChange={(event) => changeNotation({ standard: event.target.checked })} />
                      {t('layout.standard')}
                    </label>
                    <label className="gsp-check">
                      <input type="checkbox" checked={notation.tab} onChange={(event) => changeNotation({ tab: event.target.checked })} />
                      {t('layout.tab')}
                    </label>
                  </div>
                </div>
              </section>

              <section className="gsp-group">
                <h4>{t('layout.barWidths')}</h4>
                <div className="gsp-field">
                  <label htmlFor="gsp-bar-target">{t('layout.bar')}</label>
                  <select
                    id="gsp-bar-target"
                    className="gsp-select"
                    value={barWidthTarget}
                    onChange={(event) => setBarWidthTarget(Number(event.target.value))}
                    disabled={!meta?.bars}
                  >
                    {(meta?.barLabels ?? []).map((bar, index) => (
                      <option key={index + 1} value={index + 1}>
                        {bar.pickup ? t('layout.pickupBar') : (bar.label || t('layout.barNumberFallback').replace('{n}', String(index + 1)))}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-bar-width">{t('layout.barWidth')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-bar-width"
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={barWidths[barWidthTarget] ?? 100}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        const next = { ...barWidthsRef.current };
                        if (value === 100) delete next[barWidthTarget];
                        else next[barWidthTarget] = value;
                        applyBarWidths(next);
                      }}
                      disabled={!meta?.bars}
                    />
                    <span className="gsp-value">{barWidths[barWidthTarget] ?? 100}%</span>
                  </div>
                </div>
                <div className="gsp-inline" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="gsp-btn is-small is-ghost"
                    disabled={!barWidths[barWidthTarget]}
                    onClick={() => {
                      const next = { ...barWidthsRef.current };
                      delete next[barWidthTarget];
                      applyBarWidths(next);
                    }}
                  >
                    {t('layout.barWidthReset')}
                  </button>
                  <button
                    type="button"
                    className="gsp-btn is-small is-ghost"
                    disabled={!Object.keys(barWidths).length}
                    onClick={() => applyBarWidths({})}
                  >
                    {t('layout.barWidthResetAll')}
                  </button>
                </div>
                <p className="gsp-hint">{t('layout.barWidthHint')}</p>
              </section>

              <section className="gsp-group">
                <h4>{t('layout.colors')}</h4>
                <div className="gsp-field">
                  <label htmlFor="gsp-color-main">{t('layout.colorMain')}</label>
                  <input id="gsp-color-main" className="gsp-color" type="color" value={playerLayout.colors.main} onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, colors: { ...playerLayoutRef.current.colors, main: event.target.value } })} />
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-color-staff">{t('layout.colorStaff')}</label>
                  <input id="gsp-color-staff" className="gsp-color" type="color" value={playerLayout.colors.staff} onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, colors: { ...playerLayoutRef.current.colors, staff: event.target.value } })} />
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-color-bar">{t('layout.colorBar')}</label>
                  <input id="gsp-color-bar" className="gsp-color" type="color" value={playerLayout.colors.bar} onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, colors: { ...playerLayoutRef.current.colors, bar: event.target.value } })} />
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-color-number">{t('layout.colorBarNumber')}</label>
                  <input id="gsp-color-number" className="gsp-color" type="color" value={playerLayout.colors.barNumber} onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, colors: { ...playerLayoutRef.current.colors, barNumber: event.target.value } })} />
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-color-info">{t('layout.colorInfo')}</label>
                  <input id="gsp-color-info" className="gsp-color" type="color" value={playerLayout.colors.info} onChange={(event) => applyPlayerLayout({ ...playerLayoutRef.current, colors: { ...playerLayoutRef.current.colors, info: event.target.value } })} />
                </div>
              </section>

              <section className="gsp-group">
                <h4>{t('layout.fonts')}</h4>
                <div className="gsp-field">
                  <label htmlFor="gsp-font-element">{t('layout.fontElement')}</label>
                  <select
                    id="gsp-font-element"
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
                  <label htmlFor="gsp-font-family">{t('layout.fontFamily')}</label>
                  <input
                    id="gsp-font-family"
                    className="gsp-input"
                    type="text"
                    value={selectedFont.family ?? ''}
                    placeholder={t('layout.fontDefault')}
                    onChange={(event) => applyFont({ family: event.target.value })}
                  />
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-font-size">{t('layout.fontSize')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-font-size"
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
                    <button
                      type="button"
                      className="gsp-btn is-small is-ghost"
                      onClick={() => {
                        const fonts = { ...playerLayoutRef.current.fonts };
                        delete fonts[fontKey];
                        applyPlayerLayout({ ...playerLayoutRef.current, fonts });
                      }}
                    >
                      {t('layout.fontClear')}
                    </button>
                  </div>
                </div>
                <p className="gsp-hint">{t('layout.fontHint')}</p>
              </section>

              <section className="gsp-group">
                <h4>{t('player.title')}</h4>
                <div className="gsp-field">
                  <label htmlFor="gsp-speed">{t('speed')}</label>
                  <select
                    id="gsp-speed"
                    className="gsp-select"
                    value={speed}
                    onChange={(event) => changeSpeed(Number(event.target.value))}
                  >
                    <option value={0.5}>0.5×</option>
                    <option value={0.75}>0.75×</option>
                    <option value={1}>1.0×</option>
                    <option value={1.25}>1.25×</option>
                    <option value={1.5}>1.5×</option>
                  </select>
                </div>
                <div className="gsp-field">
                  <label htmlFor="gsp-volume">{t('volume')}</label>
                  <div className="gsp-inline">
                    <input
                      id="gsp-volume"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(volume * 100)}
                      onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                    />
                    <span className="gsp-value">{Math.round(volume * 100)}%</span>
                  </div>
                </div>
                <div className="gsp-pill-row">
                  <button
                    type="button"
                    className={`gsp-pill ${metronome ? 'is-on' : ''}`}
                    onClick={() => changeMetronome(!metronome)}
                    aria-pressed={metronome}
                    disabled={externalActive}
                  >
                    <MetronomeIcon /> {t('metronome')}
                  </button>
                  <button
                    type="button"
                    className={`gsp-pill ${countIn ? 'is-on' : ''}`}
                    onClick={() => changeCountIn(!countIn)}
                    aria-pressed={countIn}
                    disabled={externalActive}
                  >
                    {t('countIn')}
                  </button>
                  <button
                    type="button"
                    className={`gsp-pill ${loop ? 'is-on' : ''}`}
                    onClick={() => changeLoop(!loop)}
                    aria-pressed={loop}
                  >
                    <LoopIcon /> {t('loop')}
                  </button>
                </div>
              </section>

              <section className="gsp-group">
                <h4>{t('tools')}</h4>
                <div className="gsp-inline" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="gsp-btn is-small" onClick={() => setPanel('audio')}>
                    <AudioIcon /> {t('audio')}
                  </button>
                  <button type="button" className="gsp-btn is-small is-ghost" onClick={() => applyPlayerLayout(defaultPlayerLayout())}>
                    {t('layout.reset')}
                  </button>
                </div>
                <p className="gsp-hint">{t('studio.playerHint')}</p>
                <button
                  type="button"
                  className="gsp-btn is-primary gsp-cta-wide"
                  onClick={openStudio}
                  disabled={!hasScore || status !== 'ready'}
                >
                  <VideoIcon /> {t('studio.open')}
                </button>
              </section>
            </div>
            <div className="gsp-side-foot">
              <a href="https://www.alphatab.net" target="_blank" rel="noreferrer">
                {t('footer.alphaTab')}
              </a>
            </div>
          </aside>
        )}

        {panel === 'tracks' && (
          <aside className="gsp-side" aria-label={t('tracks.title')}>
            <div className="gsp-side-head">
              <h3>{t('tracks.title')}</h3>
              <button type="button" className="gsp-side-close" onClick={() => setPanel(null)} aria-label={t('common.close')}>
                <CloseIcon />
              </button>
            </div>
            <div className="gsp-side-body">
              {meta?.tracks.map((track) => {
                const live = apiRef.current?.score?.tracks.find((candidate) => candidate.index === track.index);
                const mute = live?.playbackInfo.isMute ?? false;
                const solo = live?.playbackInfo.isSolo ?? false;
                const level = Math.round((live?.playbackInfo.volume ?? 1) * 100);
                return (
                  <div key={track.index} className={`gsp-track ${trackIndex === track.index ? 'is-active' : ''}`}>
                    <button type="button" className="gsp-track-main" onClick={() => changeTrack(track.index)}>
                      <span className="gsp-track-dot" />
                      <span className="gsp-track-name" title={track.name}>{track.name}</span>
                    </button>
                    <div className="gsp-track-actions">
                      <button
                        type="button"
                        className={`gsp-mini ${mute ? 'is-on' : ''}`}
                        onClick={() => toggleTrackMute(track.index)}
                        title={t('tracks.mute')}
                      >
                        M
                      </button>
                      <button
                        type="button"
                        className={`gsp-mini ${solo ? 'is-on' : ''}`}
                        onClick={() => toggleTrackSolo(track.index)}
                        title={t('tracks.solo')}
                      >
                        S
                      </button>
                    </div>
                    <div className="gsp-track-volume">
                      <VolumeIcon muted={level <= 0} />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={level}
                        onChange={(event) => changeTrackLevel(track.index, Number(event.target.value))}
                        aria-label={t('tracks.volume')}
                      />
                    </div>
                  </div>
                );
              })}
              {!meta?.tracks.length && <p className="gsp-hint">{t('common.none')}</p>}
            </div>
          </aside>
        )}

        {panel === 'audio' && (
          <aside className="gsp-side" aria-label={t('audio.title')}>
            <div className="gsp-side-head">
              <h3>{t('audio.title')}</h3>
              <button type="button" className="gsp-side-close" onClick={() => setPanel(null)} aria-label={t('common.close')}>
                <CloseIcon />
              </button>
            </div>
            <div className="gsp-side-body">
              {!externalActive ? (
                <>
                  <p className="gsp-hint">{t('audio.noMedia')}</p>
                  {meta?.hasBackingTrack && <span className="gsp-chip is-accent">{t('audio.embedded')}</span>}
                  <label className="gsp-check" style={{ marginTop: 10 }}>
                    <input type="checkbox" checked={countIn} onChange={(event) => changeCountIn(event.target.checked)} />
                    {t('countIn')}
                  </label>
                  <div className="gsp-inline" style={{ marginTop: 12 }}>
                    <button type="button" className="gsp-btn is-primary" onClick={() => mediaInputRef.current?.click()}>
                      <AudioIcon /> {t('audio.load')}
                    </button>
                    <button type="button" className="gsp-btn is-ghost is-small" onClick={() => fileInputRef.current?.click()}>
                      {t('header.open')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="gsp-inline" style={{ marginBottom: 10, minWidth: 0 }}>
                    <span className="gsp-chip is-accent">{external?.kind === 'video' ? <VideoIcon /> : <AudioIcon />}</span>
                    <span className="gsp-file-name" style={{ fontSize: 12 }} title={external?.name}>{external?.name}</span>
                  </div>
                  <div className="gsp-field">
                    <label htmlFor="gsp-offset">{t('audio.offset')}</label>
                    <div className="gsp-inline">
                      <input
                        id="gsp-offset"
                        className="gsp-input"
                        type="number"
                        min={0}
                        max={120}
                        step={0.1}
                        value={offsetSec}
                        onChange={(event) => changeOffset(Number(event.target.value))}
                      />
                      <span className="gsp-hint" style={{ margin: 0 }}>{t('audio.offsetUnit')}</span>
                      <button
                        type="button"
                        className="gsp-btn is-small"
                        title={t('audio.calibrateHint')}
                        onClick={() => {
                          const media = mediaRef.current;
                          const api = apiRef.current;
                          if (!media || !api) return;
                          const next = (media.currentTime * 1000 - api.timePosition) / 1000;
                          changeOffset(next);
                        }}
                      >
                        {t('audio.calibrate')}
                      </button>
                    </div>
                  </div>
                  <p className="gsp-hint">{t('audio.offsetHint')}</p>
                  <p className="gsp-hint">{t('audio.syncHint')}</p>
                  {external?.kind === 'video' && <p className="gsp-hint">{t('audio.videoNote')}</p>}
                  <div className="gsp-inline" style={{ justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="gsp-btn is-small" onClick={() => mediaInputRef.current?.click()}>
                      {t('audio.replace')}
                    </button>
                    <button type="button" className="gsp-btn is-small is-danger" onClick={removeMedia}>
                      <TrashIcon /> {t('audio.remove')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        )}

      </div>

      <div className="gsp-progress">
        <span className="gsp-progress-fill" style={{ width: `${progressPct}%` }} />
        <input
          className="gsp-progress-input"
          type="range"
          min={0}
          max={Math.max(1, effectiveDuration)}
          step={50}
          value={clamp(position, 0, Math.max(1, effectiveDuration))}
          onChange={(event) => seek(Number(event.target.value))}
          disabled={!hasScore || effectiveDuration <= 0}
          aria-label={t('play.seek')}
        />
      </div>

      <footer className="gsp-player">
        <div className="gsp-player-left">
          <button
            type="button"
            className="gsp-player-btn"
            onClick={() => fileInputRef.current?.click()}
            title={fileName ? t('header.replace') : t('header.open')}
            aria-label={fileName ? t('header.replace') : t('header.open')}
          >
            <FolderIcon />
          </button>
          <button
            type="button"
            className="gsp-player-btn is-play"
            onClick={togglePlay}
            disabled={!hasScore || status === 'loading'}
            title={playing ? t('pause') : t('play')}
            aria-label={playing ? t('pause') : t('play')}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="gsp-player-btn"
            onClick={stopPlayback}
            disabled={!hasScore}
            title={t('stop')}
            aria-label={t('stop')}
          >
            <StopIcon />
          </button>
          {status === 'loading' && <span className="gsp-player-spinner" />}
          <div className="gsp-song" title={scoreTitle}>
            <strong>{scoreTitle}</strong>
            {scoreArtist && <span> — {scoreArtist}</span>}
          </div>
          <div className="gsp-player-time">
            {formatClock(position)} / {formatClock(effectiveDuration)}
          </div>
        </div>
        <div className="gsp-player-right">
          <button
            type="button"
            className={`gsp-player-btn ${panel === 'audio' ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === 'audio' ? null : 'audio')}
            disabled={!hasScore}
            title={t('audio')}
            aria-expanded={panel === 'audio'}
          >
            <AudioIcon />
            <span className="gsp-player-label">{t('audio')}</span>
            <span className={`gsp-dot ${externalActive || meta?.hasBackingTrack ? '' : 'is-muted'}`} />
          </button>
          <button
            type="button"
            className={`gsp-player-btn ${panel === 'tracks' ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === 'tracks' ? null : 'tracks')}
            disabled={!hasScore}
            title={t('tracks')}
            aria-expanded={panel === 'tracks'}
          >
            <TracksIcon />
            <span className="gsp-player-label">{t('tracks')}</span>
          </button>
          <button
            type="button"
            className={`gsp-player-btn ${panel === 'settings' ? 'is-active' : ''}`}
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
            disabled={!hasScore}
            title={t('settings')}
            aria-expanded={panel === 'settings'}
          >
            <SettingsIcon />
            <span className="gsp-player-label">{t('settings')}</span>
          </button>
          <button
            type="button"
            className="gsp-player-btn is-cta"
            onClick={openStudio}
            disabled={!hasScore || status !== 'ready'}
            title={t('studio.openHint')}
          >
            <VideoIcon />
            <span className="gsp-player-label">{t('studio.open')}</span>
          </button>
        </div>
      </footer>

      {view === 'studio' && (
        <div className="gsp-studio-layer">
          <VideoStudio
            t={t}
            api={apiRef.current}
            bytes={bytesRef.current}
            meta={meta}
            fileName={fileName}
            trackIndex={trackIndex}
            layout={studioLayout}
            notation={notation}
            external={external}
            studio={studio}
            audioSource={studioAudio}
            barWidths={barWidths}
            barWidthTarget={barWidthTarget}
            onBarWidthTargetChange={setBarWidthTarget}
            onBarWidthChange={changeBarWidth}
            onBarWidthReset={resetBarWidth}
            assetBase={assets.assetBase}
            scriptFile={assets.scriptFile}
            fontDirectory={assets.fontDirectory}
            soundFontUrl={assets.soundfont}
            exportCodecSupported={exportCodecSupported}
            onStudioChange={setStudio}
            onLayoutChange={applyStudioLayout}
            onNotationChange={changeNotation}
            onTrackChange={changeTrack}
            onClose={closeStudio}
            onNotify={notify}
          />
        </div>
      )}

      <div className="gsp-media-holder" aria-hidden="true">
        <video
          ref={mediaRef}
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          style={{ width: 1, height: 1 }}
        />
      </div>

      {toast && (
        <div className={`gsp-toast ${toast.kind === 'error' ? 'is-error' : toast.kind === 'success' ? 'is-success' : ''}`} role="status">
          {toast.text}
          <button type="button" className="gsp-btn is-ghost is-small" onClick={() => setToast(null)}>{t('common.close')}</button>
        </div>
      )}
    </div>
  );
}
