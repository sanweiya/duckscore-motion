/**
 * Offscreen score rendering and canvas painting for video export.
 *
 * alphaTab renders the score as a set of absolutely positioned SVG partials.
 * We turn those partials into images once, then paint only the visible crop on
 * every recorded frame. That keeps long scores within canvas limits and gives
 * the cursor an independent, precise overlay.
 */
import type { AlphaTabApi } from '@coderline/alphatab';
import { BRAVURA_WOFF2_BASE64 } from './bravura';
import { loadPoweredByBadge, POWERED_BY_BADGE_ASPECT } from './brand';
import { applyFontOverrides, secondaryVoiceColor, type FontKey, type FontOverride, type ScoreColors } from './score-style';

export interface VideoTile {
  image: HTMLImageElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VideoBeatBounds {
  /** X position where the playhead should sit. */
  x: number;
  /** Vertical span of the current staff system. */
  systemTop: number;
  systemH: number;
  /**
   * X position of the rightmost staff line of the system this beat belongs to
   * (the closing barline of the last bar on that line). The playhead decelerates
   * towards it when the line runs out of notes; undefined if the closing line
   * could not be measured.
   */
  lineEnd?: number;
}

export interface VideoSystem {
  /** Top of this staff system's rendered partial, in score surface coordinates. */
  top: number;
  /** Bottom of that partial (where the next line starts). */
  bottom: number;
}

export interface VideoScore {
  tiles: VideoTile[];
  width: number;
  height: number;
  beats: Map<string, VideoBeatBounds>;
  /**
   * One band per staff system, in surface order. A page layout paints one SVG
   * partial per system, so these are exactly the regions a single-line view
   * shows: everything outside the active band belongs to another line. Bands
   * that hold no staff (page captions, tuning info) are excluded.
   */
  systems: VideoSystem[];
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  credits: string;
  trackName: string;
  fonts: Partial<Record<FontKey, FontOverride>>;
  /**
   * Official "Powered by alphaTab" badge. It is drawn in addition to the
   * built-in in-score attribution, never as a replacement for it.
   */
  creditBadge?: HTMLImageElement | null;
  /** Dark-surface variant of the official badge. */
  creditBadgeDark?: HTMLImageElement | null;
}

export interface VideoScoreOptions {
  mount: HTMLElement;
  bytes: Uint8Array;
  trackIndex: number;
  barsPerRow: number;
  stretchForce: number;
  /** Power-law spacing between note durations (1.2-2.0). */
  spacingRatio?: number;
  /** Per-bar width percentages keyed by 1-based bar number. */
  barWidths?: Record<number, number>;
  /** alphaTab display scale. It changes wrapping/density before the surface is fitted to the frame. */
  scale?: number;
  /**
   * Page is the natural video layout; horizontal is fitted by height and
   * panned. `pageLine` uses the identical page surface and is only differentiated
   * by the camera/clip in `layoutVideoCanvas`.
   */
  layoutMode?: 'page' | 'pageLine' | 'horizontal';
  voice2: number;
  fonts: Partial<Record<FontKey, FontOverride>>;
  colors: ScoreColors;
  title: string;
  artist: string;
  trackName: string;
  standardNotation: boolean;
  tablature: boolean;
  scriptFile: string;
  fontDirectory: string;
}

export type VideoTheme = 'light' | 'dark';

export interface VideoLayoutOptions {
  /** Draw the title/subtitle/credits block above the score. */
  showHeader: boolean;
  /** Draw the page card and outer margins. When false the score is full-bleed. */
  showMargins: boolean;
  /** Horizontal scores are fitted by height and panned with a horizontal camera. */
  horizontal?: boolean;
  /**
   * Page layout that shows one staff system at a time: the surface is laid out
   * exactly like a page, but only the active line is visible and the view jumps
   * to the next line without any scrolling animation.
   */
  singleLine?: boolean;
  /** Camera zoom for horizontal scores (0.25-2). */
  zoom?: number;
  /** Surface theme: light paper with dark notation, or the inverse. */
  theme?: VideoTheme;
}

export const DEFAULT_VIDEO_LAYOUT: VideoLayoutOptions = {
  showHeader: true,
  showMargins: true,
  theme: 'light',
};

export type CursorEffect = 'none' | 'glow';

/**
 * How much of the smoothing filter delay is cancelled by reading the score
 * ahead of the audio. `normal` is the balanced default.
 */
export type CursorLookahead = 'off' | 'conservative' | 'normal' | 'aggressive';

export const CURSOR_LOOKAHEAD_FACTOR: Record<CursorLookahead, number> = {
  off: 0,
  conservative: 0.6,
  normal: 0.9,
  aggressive: 1,
};

export interface CursorStyle {
  color: string;
  /** Line width in output pixels at 1920 px width. */
  width: number;
  /** 0..1 */
  opacity: number;
  effect: CursorEffect;
  /** 0..1 strength for the glow effect. */
  effectStrength: number;
  /**
   * 0..1 extra length of the playhead beyond the staff lines. 0.45 reaches
   * roughly half a system height above and below the staff.
   */
  length: number;
  /** Delay compensation applied while smoothing is active. */
  lookahead: CursorLookahead;
  /**
   * 0..1 extra smoothing of the horizontal playhead motion.
   * It only damps the drawn position and the camera, never the score/audio
   * clock, so a steadier picture is bought with a small deliberate lag.
   */
  smoothing: number;
}

export const DEFAULT_CURSOR_STYLE: CursorStyle = {
  color: '#1c71d8',
  width: 5,
  opacity: 0.4,
  effect: 'glow',
  effectStrength: 0.75,
  length: 1,
  lookahead: 'normal',
  smoothing: 1,
};

export interface CursorFrame {
  bounds: VideoBeatBounds;
  next?: VideoBeatBounds;
  /** 0..1 progress through the current beat. */
  progress: number;
  /** Interpolated x inside the score surface. */
  x: number;
}

const SCORE_SURFACE_WIDTH = 1760;
/** Transparent gutter around every rasterized partial (see the tile builder). */
const TILE_PADDING = 48;
/**
 * Width of a page-layout surface: the layout host plus the transparent gutter
 * on both sides. Both single-line framings derive their base scale from this,
 * so the same Zoom value shows the staff at the same size in each.
 */
const PAGE_SURFACE_WIDTH = SCORE_SURFACE_WIDTH + TILE_PADDING * 2;

let fontCssPromise: Promise<string> | null = null;

/** A stable key independent of alphaTab's process-wide beat id counter. */
export function beatKey(beat: any): string {
  const bar = beat.voice.bar;
  const staff = bar.staff;
  const track = staff.track;
  return `${track.index}:${staff.index}:${bar.index}:${beat.voice.index}:${beat.index}`;
}

/** Load the embedded Bravura font CSS for isolated SVG images. */
export function loadBravuraCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = Promise.resolve(
      `@font-face{font-family:'Bravura';src:url(data:font/woff2;base64,${BRAVURA_WOFF2_BASE64}) format('woff2');font-weight:normal;font-style:normal;font-display:block;}.at-surface-svg text{dominant-baseline:alphabetic;white-space:pre;}.at{font-family:'Bravura';font-size:36px;font-style:normal;font-weight:normal;line-height:1;}`,
    );
  }
  return fontCssPromise;
}

function injectFont(svg: string, fontCss: string): string {
  const openEnd = svg.indexOf('>');
  if (openEnd < 0) return svg;
  return `${svg.slice(0, openEnd + 1)}<style>${fontCss}</style>${svg.slice(openEnd + 1)}`;
}

function padSvg(svg: string, pad: number): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const width = Number.parseFloat(root.getAttribute('width') ?? '');
  const height = Number.parseFloat(root.getAttribute('height') ?? '');
  if (!(width > 0) || !(height > 0)) return svg;
  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[ ,]+/).map(Number);
  const hasViewBox = viewBox.length === 4 && viewBox.every((value) => Number.isFinite(value));
  const minX = hasViewBox ? viewBox[0] : 0;
  const minY = hasViewBox ? viewBox[1] : 0;
  const boxW = hasViewBox ? viewBox[2] : width;
  const boxH = hasViewBox ? viewBox[3] : height;
  root.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${boxW + pad * 2} ${boxH + pad * 2}`);
  root.setAttribute('width', String(boxW + pad * 2));
  root.setAttribute('height', String(boxH + pad * 2));
  return new XMLSerializer().serializeToString(root);
}

function scaleSvgResolution(svg: string, factor: number): string {
  if (!(factor > 1)) return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const width = Number.parseFloat(root.getAttribute('width') ?? '');
  const height = Number.parseFloat(root.getAttribute('height') ?? '');
  if (!(width > 0) || !(height > 0)) return svg;
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  root.setAttribute('width', String(width * factor));
  root.setAttribute('height', String(height * factor));
  return new XMLSerializer().serializeToString(root);
}

function svgToImage(svg: string, fontCss: string): Promise<HTMLImageElement> {
  const blob = new Blob([injectFont(svg, fontCss)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('乐谱 SVG 光栅化失败'));
    };
    image.src = url;
  });
}

function parsePx(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Wait until alphaTab has painted every partial into the offscreen surface. */
function waitForRender(api: AlphaTabApi): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offFinish();
      offError();
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error('乐谱渲染超时')), 90_000);
    const offFinish = api.postRenderFinished.on(() => {
      window.setTimeout(() => finish(), 80);
    });
    const offError = api.error.on((error) => finish(error));
  });
}

/**
 * Render one score at video width, extract every partial as an image, and
 * record the geometry needed to draw the playhead later.
 */
export async function renderVideoScore(
  alphaTab: typeof import('@coderline/alphatab'),
  options: VideoScoreOptions,
): Promise<VideoScore> {
  const mount = options.mount;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'absolute',
    left: '-20000px',
    top: '0',
    width: `${SCORE_SURFACE_WIDTH}px`,
    minHeight: '100px',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '-1',
  });
  mount.appendChild(host);

  const layoutMode = options.layoutMode === 'horizontal'
    ? alphaTab.LayoutMode.Horizontal
    : alphaTab.LayoutMode.Page;
  const settings: any = {
    core: {
      scriptFile: options.scriptFile,
      fontDirectory: options.fontDirectory,
      useWorkers: false,
      enableLazyLoading: false,
      logLevel: alphaTab.LogLevel.Warning,
      smuflFontSources: new Map([[alphaTab.FontFileFormat.Woff2, `data:font/woff2;base64,${BRAVURA_WOFF2_BASE64}`]]),
    },
    display: {
      layoutMode,
      // Horizontal surfaces are much wider than they are tall. Keep the
      // alphaTab layout at 1x: scaling the layout made staff visibility changes
      // render inconsistent glyph geometry. Rasterize the SVG tiles at 2x below
      // for sharpness instead.
      scale: options.layoutMode === 'horizontal' ? 1 : (options.scale ?? 1),
      stretchForce: options.stretchForce,
      spacingRatio: options.spacingRatio ?? Math.SQRT2,
      barsPerRow: options.barsPerRow,
      padding: options.layoutMode === 'horizontal' ? [18, 24] : [42, 48],
      resources: {
        mainGlyphColor: options.colors.main,
        secondaryGlyphColor: secondaryVoiceColor(options.voice2, options.colors.main).rgba,
        staffLineColor: options.colors.staff,
        barSeparatorColor: options.colors.bar,
        barNumberColor: options.colors.barNumber,
        scoreInfoColor: options.colors.info,
      },
    },
    player: {
      playerMode: alphaTab.PlayerMode.Disabled,
    },
  };

  const api = new alphaTab.AlphaTabApi(host, settings);
  // alphaTab paints its "♪ alphaTab.net" attribution above the bar returned by
  // the layout. Horizontal layouts pick the bar at the end of the first viewport
  // partial, which lands in the middle of a long score (and of the video). Keep
  // the attribution, but let it close the score at its last bar instead.
  const rendererLayout = (api as any).renderer?.instance?.layout;
  if (options.layoutMode === 'horizontal' && rendererLayout
    && typeof rendererLayout.getAttributionRendererIndex === 'function') {
    // The attribution is still drawn in full, just anchored to the last bar of
    // the score instead of the bar where the first viewport partial ends
    // (which lands in the middle of a long horizontal score). The last bar also
    // guarantees room to its left, so the text is never clipped by the surface.
    // Return 0 here to anchor it above the first bar instead.
    const placeAttribution = (system: any): number => {
      const bars = system?.staves?.[0]?.barRenderers?.length
        ?? system?.masterBarsRenderers?.length
        ?? 0;
      return bars > 0 ? bars - 1 : 0;
    };
    // Patch only this layout instance. Mutating the shared prototype would leak
    // the re-anchoring into every other alphaTab instance in the page (e.g. the
    // main player), changing its rendered attribution placement. The layout is
    // only recreated on a layoutMode change, which never happens inside this
    // short-lived render api, so the instance patch covers re-renders
    // (api.render() keeps the existing layout instance).
    rendererLayout.getAttributionRendererIndex = placeAttribution;
  }
  // The video header already shows title/credits; hide the equivalent block
  // inside the score so page space is used for notation only.
  for (const element of [
    alphaTab.NotationElement.ScoreTitle,
    alphaTab.NotationElement.ScoreSubTitle,
    alphaTab.NotationElement.ScoreArtist,
    alphaTab.NotationElement.ScoreAlbum,
    alphaTab.NotationElement.ScoreWords,
    alphaTab.NotationElement.ScoreMusic,
    alphaTab.NotationElement.ScoreWordsAndMusic,
    alphaTab.NotationElement.ScoreCopyright,
    alphaTab.NotationElement.TrackNames,
  ]) {
    api.settings.notation.elements.set(element, false);
  }
  applyFontOverrides(api, options.fonts);
  api.scoreLoaded.on((score: any) => {
    // The video header carries all title/credit information. Hide the
    // score's own header/footer styles as well; otherwise custom entries like
    // "Arr. by ..." would still be painted inside the score.
    for (const container of [score.style?.headerAndFooter, score.stylesheet?.headerAndFooter]) {
      if (container instanceof Map) {
        for (const style of container.values()) style.isVisible = false;
      }
    }
    const track = score.tracks.find((candidate: any) => candidate.index === options.trackIndex) ?? score.tracks[0];
    if (!track) return;
    for (const staff of track.staves) {
      staff.showStandardNotation = options.standardNotation;
      staff.showTablature = options.tablature;
    }
  });
  let fontCss = '';
  try {
    fontCss = await loadBravuraCss();
    const rendered = waitForRender(api);
    rendered.catch(() => undefined);
    const loaded = api.load(options.bytes, [options.trackIndex]);
    if (!loaded) throw new Error('无法加载该乐谱文件');
    await rendered;

    if (options.barWidths && Object.keys(options.barWidths).length > 0) {
      const score = api.score as any;
      const track = score?.tracks.find((candidate: any) => candidate.index === options.trackIndex) ?? score?.tracks?.[0];
      if (score && track) {
        const factorFor = (index: number) => {
          const value = options.barWidths![index + 1];
          return typeof value === 'number' ? Math.min(2, Math.max(0.5, value / 100)) : 1;
        };
        if (options.layoutMode === 'horizontal') {
          const bases = new Map<number, number>();
          const displayScale = api.settings.display.scale || 1;
          for (const system of api.boundsLookup?.staffSystems ?? []) {
            for (const bar of system.bars) bases.set(bar.index, bar.realBounds.w / displayScale);
          }
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
          const rerender = waitForRender(api);
          api.render();
          await rerender;
        } else {
          const systems = (api.boundsLookup?.staffSystems ?? [])
            .map((system) => system.bars.length)
            .filter((count) => count > 0);
          if (systems.length > 0) {
            track.systemsLayout = systems;
            track.defaultSystemsLayout = systems[0];
            api.settings.display.systemsLayoutMode = alphaTab.SystemsLayoutMode.UseModelLayout;
            for (const staff of track.staves) {
              for (const bar of staff.bars) bar.displayScale = factorFor(bar.index);
            }
            for (const bar of score.masterBars) bar.displayScale = factorFor(bar.index);
            api.updateSettings();
            const rerender = waitForRender(api);
            api.render();
            await rerender;
          }
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      }
    }

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const surface = host.querySelector<HTMLElement>('.at-surface');
    if (!surface) throw new Error('未找到乐谱渲染结果');

    const tiles: VideoTile[] = [];
    for (const child of Array.from(surface.children) as HTMLElement[]) {
      const svg = child.querySelector('svg');
      if (!svg) continue;
      const x = parsePx(child.style.left);
      const y = parsePx(child.style.top);
      const w = parsePx(child.style.width, parsePx(svg.getAttribute('width')));
      const h = parsePx(child.style.height, parsePx(svg.getAttribute('height')));
      if (w <= 0 || h <= 0) continue;
      const serialized = new XMLSerializer().serializeToString(svg);
      // Centered SMuFL glyphs (clef, time signature, rests) extend to the left
      // of their anchor. Give every tile a transparent gutter so those paths
      // are not clipped by the SVG viewport.
      const image = await svgToImage(
        scaleSvgResolution(padSvg(serialized, TILE_PADDING), options.layoutMode === 'horizontal' ? 2 : 1),
        fontCss,
      );
      tiles.push({
        image,
        x: x - TILE_PADDING,
        y: y - TILE_PADDING,
        w: w + TILE_PADDING * 2,
        h: h + TILE_PADDING * 2,
      });
    }
    if (tiles.length === 0) throw new Error('乐谱没有可渲染的内容');

    // Horizontal layout can place the first partial at a negative x offset
    // (clef/time-signature space). Normalize negative extents so the beginning
    // of the staff is not clipped by the page edge.
    const minX = Math.min(...tiles.map((tile) => tile.x));
    const minY = Math.min(...tiles.map((tile) => tile.y));
    const offsetX = minX < 0 ? -minX : 0;
    const offsetY = minY < 0 ? -minY : 0;
    if (offsetX || offsetY) {
      for (const tile of tiles) {
        tile.x += offsetX;
        tile.y += offsetY;
      }
    }
    const width = Math.max(...tiles.map((tile) => tile.x + tile.w));
    const height = Math.max(...tiles.map((tile) => tile.y + tile.h));

    const beats = new Map<string, VideoBeatBounds>();
    const score = api.score as any;
    if (!score) throw new Error('乐谱数据为空');
    const track = score.tracks.find((candidate: any) => candidate.index === options.trackIndex) ?? score.tracks[0];
    const boundsLookup = api.boundsLookup;
    // Where each staff system ends horizontally. Staff lines of a system are
    // painted from the first bar to the closing barline of the last bar, so the
    // maximum right edge of the system's master bars is exactly the vertical
    // line the playhead should stop at. Cached per system because the lookup is
    // queried once per beat.
    const systemLineEnds = new Map<any, number | null>();
    const lineEndOf = (masterBarBounds: any): number | null => {
      const staffSystem = masterBarBounds?.staffSystemBounds;
      if (!staffSystem) return null;
      if (systemLineEnds.has(staffSystem)) return systemLineEnds.get(staffSystem) ?? null;
      let right = Number.NEGATIVE_INFINITY;
      for (const barBounds of staffSystem.bars ?? []) {
        const aligned = barBounds?.lineAlignedBounds;
        const box = aligned && aligned.w > 0
          ? aligned
          : barBounds?.realBounds ?? barBounds?.visualBounds;
        if (box && Number.isFinite(box.x) && Number.isFinite(box.w)) {
          right = Math.max(right, box.x + box.w);
        }
      }
      const measured = Number.isFinite(right) ? right : null;
      systemLineEnds.set(staffSystem, measured);
      return measured;
    };
    if (track && boundsLookup) {
      for (const staff of track.staves) {
        for (const bar of staff.bars) {
          for (const voice of bar.voices) {
            for (const beat of voice.beats) {
              const beatBounds = boundsLookup.findBeat(beat);
              if (!beatBounds) continue;
              // The playhead should sit on the staff lines themselves. The
              // visual bounds also cover everything printed above and below the
              // staff (tempo marks, "sl." lines, the attribution, lyrics), which
              // made the cursor run up into that text. The line aligned bounds
              // are exactly aligned with the staff lines of the system.
              const masterBarBounds = beatBounds.barBounds.masterBarBounds;
              const lineAligned = masterBarBounds.lineAlignedBounds;
              const system = lineAligned && lineAligned.h > 0
                ? lineAligned
                : masterBarBounds.visualBounds;
              const lineEnd = lineEndOf(masterBarBounds);
              beats.set(beatKey(beat), {
                x: beatBounds.onNotesX + offsetX,
                systemTop: system.y + offsetY,
                systemH: system.h,
                lineEnd: lineEnd === null ? undefined : lineEnd + offsetX,
              });
            }
          }
        }
      }
    }

    // One band per staff system: the partial that contains that system's staff
    // lines. Partials without any staff (e.g. the tuning caption above the page)
    // are page furniture, not lines, and must never become a view target.
    const bands = tiles
      .map((tile) => ({ top: tile.y + TILE_PADDING, bottom: tile.y + tile.h - TILE_PADDING }))
      .filter((band) => band.bottom - band.top > 1)
      .sort((a, b) => a.top - b.top);
    const staffTops = [...new Set([...beats.values()].map((bounds) => bounds.systemTop))]
      .sort((a, b) => a - b);
    const systems: VideoSystem[] = [];
    for (const staffTop of staffTops) {
      const band = bands.find((candidate) => staffTop >= candidate.top - 2 && staffTop <= candidate.bottom + 2);
      if (band && !systems.includes(band)) systems.push(band);
    }
    if (systems.length === 0) systems.push(...bands);

    const [creditBadge, creditBadgeDark] = await Promise.all([
      loadPoweredByBadge(false),
      loadPoweredByBadge(true),
    ]);
    return {
      tiles,
      width,
      height,
      beats,
      systems,
      title: options.title || score.title || '',
      subtitle: score.subTitle || '',
      artist: options.artist || score.artist || '',
      album: score.album || '',
      credits: [
        score.tab ? `Arr. by ${score.tab}` : '',
        score.words ? `Words by ${score.words}` : '',
        score.music ? `Music by ${score.music}` : '',
        score.copyright ? `© ${score.copyright}` : '',
      ].filter(Boolean).join('  ·  '),
      trackName: options.trackName || track?.name || '',
      fonts: options.fonts,
      creditBadge,
      creditBadgeDark,
    };
  } finally {
    api.destroy();
    host.remove();
  }
}

/** Horizontal camera follow speed (1/s) and lead-velocity smoothing (1/s). */
export const HORIZONTAL_CAMERA_FOLLOW = 3;
export const HORIZONTAL_CAMERA_LEAD_SMOOTH = 1.4;

/** Filter time constant of the optional playhead smoothing at full strength. */
const CURSOR_SMOOTHING_TAU = 0.34;
/**
 * Share of the filter delay that is cancelled by sampling the score slightly
 * ahead of the audio. A first-order filter delays everything by its time
 * constant; because the score timeline is known in advance we can look ahead
 * by the same amount, which removes the lag while keeping the jitter
 * attenuation (a time shift never changes an amplitude response).
 */
const CURSOR_SMOOTHING_LOOKAHEAD = 0.9;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Filter time constant (seconds) for a 0..1 smoothing strength. */
export function cursorSmoothingTau(strength: number): number {
  const s = clamp01(strength);
  return s > 0.001 ? 0.02 + CURSOR_SMOOTHING_TAU * s * s : 0;
}

/**
 * How far ahead of the audio the playhead sample is taken, in seconds. It is a
 * fraction of the filter delay, so most of the self-inflicted lag disappears
 * while a deliberate, strength-dependent offset is kept.
 */
export function cursorSmoothingLookahead(
  strength: number,
  mode: CursorLookahead = 'normal',
): number {
  const factor = CURSOR_LOOKAHEAD_FACTOR[mode] ?? CURSOR_SMOOTHING_LOOKAHEAD;
  return cursorSmoothingTau(strength) * factor;
}

export interface CursorSmoothingState {
  x: number | null;
  systemTop: number | null;
}

export function createCursorSmoothingState(): CursorSmoothingState {
  return { x: null, systemTop: null };
}

/**
 * Damp the horizontal playhead position.
 *
 * This is a presentation-only filter: the score time, the tick and the audio
 * clock are untouched, so the soundtrack never changes. Only the position used
 * for drawing and for the camera is filtered, which trades the remaining lag
 * behind the audio for a much steadier left/right motion. Callers pass a
 * position sampled `cursorSmoothingLookahead()` seconds ahead, so the filter
 * delay is mostly cancelled instead of being added on top.
 */
export function smoothCursorX(
  state: CursorSmoothingState,
  sampleX: number | null,
  systemTop: number | null,
  dt: number,
  strength: number,
  snapDistance: number,
  anchorX: number | null = sampleX,
): number | null {
  const s = clamp01(strength);
  const previous = state.x;
  const previousSystemTop = state.systemTop;
  state.systemTop = systemTop;
  if (sampleX === null) {
    state.x = null;
    return null;
  }
  // Snap on a seek, on a new system and on any jump that is too large to be
  // ordinary playback, so the filter never slides through a repeat.
  const snap = previous === null
    || !Number.isFinite(previous)
    || systemTop !== previousSystemTop
    || Math.abs(sampleX - previous) > snapDistance;
  if (snap || !(s > 0.001)) {
    // Snap to the true (un-advanced) position. Snapping to the look-ahead
    // sample would teleport the playhead forward whenever playback starts or
    // restarts; anchoring here lets the filter ease into the lead instead.
    const anchor = anchorX !== null && Number.isFinite(anchorX) ? anchorX : sampleX;
    state.x = anchor;
    return anchor;
  }
  const tau = cursorSmoothingTau(s);
  // A long frame must not turn the lead into a jump: cap the step so the
  // playhead always catches up over several frames.
  const step = Math.min(Math.max(0, dt), 0.05);
  const alpha = Math.min(1, 1 - Math.exp(-step / tau));
  const next = previous + (sampleX - previous) * alpha;
  state.x = next;
  return next;
}

export interface VideoCanvasLayout {
  width: number;
  height: number;
  headerH: number;
  marginX: number;
  /** Safe horizontal inset for header text when the paper margin is disabled. */
  insetX: number;
  scoreTop: number;
  scoreH: number;
  scoreW: number;
  scale: number;
  showHeader: boolean;
  showMargins: boolean;
  horizontal: boolean;
  /** Page layout restricted to one staff system at a time. */
  singleLine: boolean;
  theme: VideoTheme;
}

export function layoutVideoCanvas(
  width: number,
  height: number,
  score: VideoScore,
  options: VideoLayoutOptions = DEFAULT_VIDEO_LAYOUT,
): VideoCanvasLayout {
  const showHeader = options.showHeader !== false;
  const showMargins = options.showMargins !== false;
  const horizontal = options.horizontal === true;
  // Single-line is a page variant, never combined with the horizontal camera.
  const singleLine = !horizontal && options.singleLine === true;
  // Both single-line framings fit the line by height and zoom with the camera.
  const zoom = horizontal ? Math.min(4, Math.max(0.1, options.zoom ?? 1)) : 1;
  const marginX = showMargins ? Math.round(width * 0.052) : 0;
  const headerH = showHeader ? Math.round(height * 0.145) : 0;
  // Without a header the paper still needs a top margin; with a header the
  // header itself provides that separation.
  const scoreTop = showHeader ? headerH : (showMargins ? marginX : 0);
  // No footer bar: the score takes the freed space and keeps a bottom margin
  // equal to the left/right page margin.
  const scoreH = height - scoreTop - (showMargins ? marginX : 0) + 2;
  const scoreW = width - marginX * 2;
  // One base scale for both single-line framings, so the same Zoom value shows
  // the staff at the same size in each:
  // - horizontal fits the page width once and the camera zoom magnifies it;
  // - the single-line page keeps the page's width fit and grows by rendering
  //   the score at a larger alphaTab scale, which makes each line hold fewer
  //   bars (down to one) so the whole line still fits inside the canvas.
  // Page mode itself never zooms the camera.
  const pageFit = scoreW / score.width;
  const baseScale = scoreW / PAGE_SURFACE_WIDTH;
  const scale = horizontal ? baseScale * zoom : pageFit;
  const insetX = showMargins ? marginX : Math.max(16, Math.round(width * 0.03));
  return {
    width, height, headerH, marginX, insetX, scoreTop, scoreH, scoreW, scale,
    showHeader, showMargins, horizontal, singleLine,
    theme: options.theme === 'dark' ? 'dark' : 'light',
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (ctx.measureText(candidate).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, Math.max(1, low))}…`;
}

function fontStack(value: string | undefined, fallback: string): string {
  const entries = value
    ?.split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (!entries?.length) return fallback;
  return `${entries.map((entry) => (/\s/.test(entry) ? `"${entry}"` : entry)).join(', ')}, ${fallback}`;
}

function fontPx(value: number | undefined, width: number, fallbackRatio: number, minimum = 8): number {
  const size = value && value > 0 ? value * width / 1920 : width * fallbackRatio;
  return Math.max(minimum, Math.round(size));
}

function colorWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const parsed = full.length === 6 ? Number.parseInt(full, 16) : Number.NaN;
  if (!Number.isFinite(parsed)) return `rgba(67, 109, 157, ${alpha})`;
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/**
 * Continuous cross-section of the playhead halo.
 * `distance` is normalised to the halo radius (0 at the line, 1 at its edge),
 * so the falloff is a genuine function instead of a set of stacked bands.
 */
function haloProfile(distance: number): number {
  if (!(distance < 1)) return 0;
  const d = Math.max(0, distance);
  const tight = Math.exp(-((d / 0.30) * (d / 0.30)));
  const wide = Math.exp(-((d / 0.85) * (d / 0.85)));
  const window = 1 - d * d;
  return (0.72 * tight + 0.28 * wide) * window * window;
}

const GLOW_SPRITE_HEIGHT = 256;
const glowSpriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Build (once) a halo sprite for one colour/radius/intensity. The horizontal
 * falloff is a real `createLinearGradient` sampled densely, and the
 * longitudinal fade is multiplied in with `destination-in`, so the sprite is a
 * smooth two-dimensional gradient rather than 6-8 stacked strokes. Drawing it
 * as a single image also makes HiDPI previews and high resolution exports
 * cheap, because the cost no longer grows with the halo radius.
 */
function glowSprite(color: string, radius: number, peak: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const r = Math.round(radius);
  if (!(r >= 2) || !(peak > 0.001)) return null;
  const key = `${color}|${r}|${peak.toFixed(3)}`;
  const cached = glowSpriteCache.get(key);
  if (cached) return cached;

  const width = r * 2 + 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = GLOW_SPRITE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const center = width / 2;
  const gradient = ctx.createLinearGradient(center - r, 0, center + r, 0);
  // Dense sampling keeps the linear interpolation between colour stops below a
  // pixel, so no quantisation is visible at any device pixel ratio.
  const steps = Math.max(128, Math.min(512, Math.round(r * 8)));
  for (let i = 0; i <= steps; i += 1) {
    const stop = i / steps;
    const distance = Math.abs(stop - 0.5) * 2;
    gradient.addColorStop(stop, colorWithAlpha(color, peak * haloProfile(distance)));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, GLOW_SPRITE_HEIGHT);

  // Multiply the longitudinal fade into the sprite. destination-in keeps the
  // destination colour and scales its alpha by the source alpha, which is
  // exactly the "lit in the middle, fading towards both ends" look.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, GLOW_SPRITE_HEIGHT);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(0.12, 'rgba(0, 0, 0, 0.35)');
  fade.addColorStop(0.34, 'rgba(0, 0, 0, 0.9)');
  fade.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(0.66, 'rgba(0, 0, 0, 0.9)');
  fade.addColorStop(0.88, 'rgba(0, 0, 0, 0.35)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, GLOW_SPRITE_HEIGHT);
  ctx.globalCompositeOperation = 'source-over';

  if (glowSpriteCache.size > 64) glowSpriteCache.clear();
  glowSpriteCache.set(key, canvas);
  return canvas;
}

export interface PaintFrame {
  scrollY: number;
  /** Horizontal camera offset for Horizontal layout. */
  scrollX?: number;
  cursor: CursorFrame | null;
  /**
   * Staff system to frame when the playhead is momentarily gone (end of the
   * score): the single-line view keeps showing the line it was on instead of
   * jumping to an unrelated area of the surface.
   */
  systemTop?: number;
  accent: string;
  trackLabel: string;
  cursorStyle?: CursorStyle;
}

/** Paint one video frame. The same function drives the studio preview and export. */
export function paintVideoFrame(
  ctx: CanvasRenderingContext2D,
  score: VideoScore,
  layout: VideoCanvasLayout,
  frame: PaintFrame,
): void {
  const { width, height, headerH, marginX, insetX, scoreTop, scoreH, scoreW, scale, showHeader, showMargins, horizontal, singleLine } = layout;
  const accent = frame.accent || '#436d9d';
  const dark = layout.theme === 'dark';
  // Surface palette. Only the surface and its text change with the theme; the
  // playhead keeps whatever colour the user picked.
  const palette = dark
    ? {
        backdropFrom: '#1b2027',
        backdropMid: '#12161c',
        backdropTo: '#07090c',
        glow: 'rgba(122, 164, 214, 0.16)',
        paper: '#0b0e12',
        paperShadow: 'rgba(0, 0, 0, 0.55)',
        paperBorder: 'rgba(255, 255, 255, 0.10)',
        title: '#f4f7fb',
        subtitle: '#c3ccd8',
        credits: '#939fac',
        accentText: '#9dc4ea',
        flat: '#000000',
        watermark: 'rgba(226, 236, 247, 0.50)',
      }
    : {
        backdropFrom: '#f7f9fc',
        backdropMid: '#eef3f8',
        backdropTo: '#e2eaf3',
        glow: 'rgba(255, 255, 255, 0.95)',
        paper: '#ffffff',
        paperShadow: 'rgba(36, 64, 97, 0.10)',
        paperBorder: 'rgba(36, 64, 97, 0.12)',
        title: '#1b2430',
        subtitle: '#5e6d7e',
        credits: '#7c8b9c',
        accentText: accent,
        flat: '#ffffff',
        watermark: 'rgba(67, 109, 157, 0.52)',
      };
  const badge = dark ? (score.creditBadgeDark ?? score.creditBadge) : score.creditBadge;
  // One badge size for both modes: the header credit and the full-bleed corner
  // credit stay identical, so disabling the header does not shrink the credit.
  const badgeHeight = Math.max(24, Math.round(width * 0.0185));
  const badgeWidth = badge ? badgeHeight * POWERED_BY_BADGE_ASPECT : 0;

  ctx.clearRect(0, 0, width, height);

  if (showMargins) {
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, palette.backdropFrom);
    background.addColorStop(0.55, palette.backdropMid);
    background.addColorStop(1, palette.backdropTo);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.82, -height * 0.18, 0, width * 0.82, -height * 0.18, height * 0.9);
    glow.addColorStop(0, palette.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  } else {
    // A full-bleed render keeps no frame, no card and no decorative margins:
    // white paper in the light theme, pure black in the dark theme.
    ctx.fillStyle = palette.flat;
    ctx.fillRect(0, 0, width, height);
  }

  if (showHeader) {
    // Keep every header line clear of the right-hand credit column. On narrow
    // frames the badge is wider than the old percentage-based reserve.
    const rightReserve = Math.max(
      Math.round(width * 0.135),
      badgeWidth > 0 ? Math.round(badgeWidth + width * 0.02) : 0,
    );
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = palette.title;
    ctx.font = `600 ${fontPx(score.fonts?.title?.size, width, 0.022)}px ${fontStack(score.fonts?.title?.family, 'ui-serif, Georgia, "Times New Roman", serif')}`;
    const title = truncate(ctx, score.title || frame.trackLabel || 'Untitled score', Math.max(120, width - insetX * 2 - rightReserve));
    ctx.fillText(title, insetX, headerH * 0.45);

    ctx.fillStyle = palette.subtitle;
    ctx.font = `${fontPx(score.fonts?.subtitle?.size, width, 0.0105)}px ${fontStack(score.fonts?.subtitle?.family, 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif')}`;
    const subtitle = [score.subtitle, score.artist, score.album].filter(Boolean).join('  ·  ');
    if (subtitle) ctx.fillText(truncate(ctx, subtitle, Math.max(120, width - insetX * 2 - rightReserve)), insetX, headerH * 0.69);
    if (score.credits) {
      ctx.fillStyle = palette.credits;
      ctx.font = `${fontPx(score.fonts?.info?.size, width, 0.009)}px ${fontStack(score.fonts?.info?.family, 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif')}`;
      ctx.fillText(truncate(ctx, score.credits, Math.max(120, width - insetX * 2 - rightReserve)), insetX, headerH * 0.87);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = palette.accentText;
    ctx.font = `600 ${Math.round(width * 0.0105)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText('SCORE PLAYER', width - insetX, headerH * 0.42);
    // The credit sits right under the "SCORE PLAYER" line instead of floating
    // far below it.
    const creditTop = headerH * 0.42 + Math.max(6, Math.round(headerH * 0.06));
    if (badge && badgeWidth > 0) {
      // Official "Powered by alphaTab" badge: an unambiguous credit next to the
      // score, in addition to alphaTab's built-in in-score mark.
      ctx.drawImage(badge, width - insetX - badgeWidth, creditTop, badgeWidth, badgeHeight);
    } else {
      ctx.fillStyle = palette.subtitle;
      ctx.font = `${Math.round(width * 0.0095)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText('Powered by ♪ alphaTab.net', width - insetX, creditTop + badgeHeight * 0.72);
    }
    ctx.textAlign = 'left';
  }

  if (showMargins) {
    // Paper. Avoid canvas shadowBlur here: it is re-blurred every frame and can
    // starve the 60fps capture loop on large canvases.
    ctx.fillStyle = palette.paperShadow;
    roundRect(ctx, marginX - 10, scoreTop + 9, scoreW + 24, scoreH + 4, 16);
    ctx.fill();
    ctx.fillStyle = palette.paper;
    roundRect(ctx, marginX - 12, scoreTop + 6, scoreW + 24, scoreH + 4, 16);
    ctx.fill();
    ctx.strokeStyle = palette.paperBorder;
    ctx.lineWidth = 1;
    roundRect(ctx, marginX - 12.5, scoreTop + 5.5, scoreW + 25, scoreH + 5, 16);
    ctx.stroke();
  }

  ctx.save();
  if (showMargins) {
    roundRect(ctx, marginX - 12, scoreTop + 6, scoreW + 24, scoreH + 4, 16);
  } else {
    ctx.beginPath();
    ctx.rect(0, scoreTop, width, Math.max(1, height - scoreTop));
  }
  ctx.clip();

  const contentW = score.width * scale;
  const contentH = score.height * scale;
  const drawX = horizontal
    ? (contentW <= scoreW
        ? marginX + (scoreW - contentW) / 2
        : marginX - (frame.scrollX ?? 0))
    : marginX + (scoreW - contentW) / 2;
  const drawY = horizontal
    ? scoreTop + Math.max(0, (scoreH - contentH) / 2) - frame.scrollY
    : scoreTop - frame.scrollY;

  let bandClipped = false;
  if (singleLine) {
    // Show one staff system: clip the score to its rendered partial so the
    // neighbouring lines (and their text) are not visible. The camera already
    // placed the band at a fixed screen position, so switching lines is a plain
    // cut with no scrolling between them. Only the tiles are clipped: the
    // playhead keeps its usual overshoot into the empty paper above/below.
    // Without a cursor (the very end of the score) the caller passes the line
    // that was last shown, so the clip cannot fall back to a caption partial.
    const bandSystemTop = frame.systemTop !== undefined
      ? frame.systemTop
      : frame.cursor
        ? frame.cursor.bounds.systemTop
        : null;
    const band = systemBand(score, bandSystemTop);
    if (band) {
      const bandTop = drawY + band.top * scale;
      const bandBottom = drawY + band.bottom * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bandTop, width, Math.max(1, bandBottom - bandTop));
      ctx.clip();
      bandClipped = true;
    }
  }

  for (const tile of score.tiles) {
    const x = drawX + tile.x * scale;
    const y = drawY + tile.y * scale;
    const w = tile.w * scale;
    const h = tile.h * scale;
    if (y + h < scoreTop - 4 || y > scoreTop + scoreH + 4) continue;
    if (horizontal && (x + w < marginX - 8 || x > marginX + scoreW + 8)) continue;
    ctx.drawImage(tile.image, x, y, w, h);
  }

  if (bandClipped) ctx.restore();

  if (frame.cursor) {
    const { bounds, x } = frame.cursor;
    const cursorX = drawX + x * scale;
    const systemY = drawY + bounds.systemTop * scale;
    const systemH = bounds.systemH * scale;
    const style = frame.cursorStyle ?? DEFAULT_CURSOR_STYLE;
    const opacity = Math.min(1, Math.max(0, style.opacity));
    const strength = Math.min(1, Math.max(0, style.effectStrength));
    const lineWidth = Math.max(1, style.width * width / 1920);
    const color = style.color || accent;
    // The staff lines alone are too tight: the playhead should read as a
    // bracket around the system. The overshoot is a fraction of the system
    // height, set by the user, and clamped against the frame width so it stays
    // proportional across aspect ratios without reaching the tempo/effect text
    // the way the visual bounds do.
    const overshoot = Math.min(1, Math.max(0, style.length ?? DEFAULT_CURSOR_STYLE.length));
    const padding = Math.max(
      width * 0.006,
      Math.min(systemH * (0.12 + 0.88 * overshoot), width * 0.055),
    );
    const top = systemY - padding;
    const bottom = systemY + systemH + padding;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cursorX, top);
    ctx.lineTo(cursorX, bottom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style.effect === 'glow' && strength > 0) {
      // One continuous halo sprite: dense horizontal gradient × longitudinal
      // fade. This replaces the old stack of 7 stroked bands, whose edges could
      // be seen as rings on HiDPI displays and in high resolution exports.
      const radius = lineWidth * (1.2 + 20 * strength) / 2;
      const sprite = glowSprite(color, radius, opacity * strength * 0.95);
      if (sprite) {
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sprite, cursorX - sprite.width / 2, top, sprite.width, bottom - top);
      }

      // The glowing core fades at both ends so it reads as light rather than a
      // hard bar. This fade is intentionally not used for the plain line.
      const core = ctx.createLinearGradient(0, top, 0, bottom);
      core.addColorStop(0, colorWithAlpha(color, 0));
      core.addColorStop(0.12, colorWithAlpha(color, opacity * 0.58));
      core.addColorStop(0.34, colorWithAlpha(color, opacity * 0.96));
      core.addColorStop(0.5, colorWithAlpha(color, opacity));
      core.addColorStop(0.66, colorWithAlpha(color, opacity * 0.96));
      core.addColorStop(0.88, colorWithAlpha(color, opacity * 0.58));
      core.addColorStop(1, colorWithAlpha(color, 0));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = core;
      ctx.lineWidth = lineWidth;
      ctx.stroke();

      // A thin highlight through the center gives the playhead a lit-from-within
      // look without adding a dot or a bar wash.
      ctx.strokeStyle = `rgba(255, 255, 255, ${(opacity * 0.48).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, lineWidth * 0.34);
      ctx.stroke();
    } else {
      // No effect: a solid line, no faded ends and no highlight.
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  if (!showHeader) {
    // Our own credit for the clean, headerless mode, drawn after the score so a
    // full-bleed frame cannot cover it. The official badge spells out that the
    // notation engine is what "Powered by" refers to, rather than leaving a bare
    // domain that could be mistaken for a score distribution site.
    if (badge) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(badge, width - 16 - badgeWidth, height - 14 - badgeHeight, badgeWidth, badgeHeight);
      ctx.globalAlpha = 1;
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = palette.watermark;
      ctx.font = `${Math.max(9, Math.round(width * 0.0075))}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText('Powered by ♪ alphaTab.net', width - 12, height - 10);
      ctx.textAlign = 'left';
    }
  }
}

/**
 * Speed at the closing barline, relative to the note cadence. The playhead
 * leaves the last note at exactly the cadence (it never speeds up) and keeps
 * easing down until the line switches, so the line end is a plain slow-down:
 * no kick at the last note, no brake, no stop. It is still gliding when the
 * next line begins.
 *
 * With a constant deceleration the glide covers `(1 + this) / 2` of the gap to
 * the closing barline, so a lower value slows the line end down more but stops
 * a little further from the right edge.
 */
const LINE_END_END_SPEED = 0.6;

/**
 * Position curve for the end-of-line glide, as a fraction of the gap to the
 * closing barline: one constant deceleration from the note cadence to
 * `LINE_END_END_SPEED`, spread over the whole beat. The speed at the last note
 * is exactly the speed the playhead already had between notes, so there is no
 * visible switch in pace, only a gradual slow-down.
 */
function lineEndEase(progress: number): number {
  const p = clamp01(progress);
  return p - ((1 - LINE_END_END_SPEED) / 2) * p * p;
}

/**
 * Compute the interpolated playhead for the current tick.
 *
 * Within one staff system the playhead glides linearly towards the next note.
 * When the line runs out of notes (the next beat belongs to another staff
 * system, or the score ends) there is nothing to interpolate to, so the
 * playhead keeps moving towards the closing barline while gradually slowing
 * down. The switch to the next line still happens at the exact tick where its
 * first note starts: at that moment the tick lookup returns the new beat and
 * its bounds point at the new system.
 */
export function cursorFor(
  api: AlphaTabApi,
  beats: Map<string, VideoBeatBounds>,
  trackIndexes: Set<number>,
  tick = api.tickPosition,
): CursorFrame | null {
  const tickCache = api.tickCache;
  if (!tickCache) return null;
  const lookup = tickCache.findBeat(trackIndexes, tick);
  if (!lookup) return null;
  const bounds = beats.get(beatKey(lookup.beat));
  if (!bounds) return null;

  const nextBounds = lookup.nextBeat ? beats.get(beatKey(lookup.nextBeat.beat)) : undefined;
  const rawProgress = lookup.tickDuration > 0 ? (tick - lookup.start) / lookup.tickDuration : 0;
  const progress = Math.min(1, Math.max(0, rawProgress));
  let x = bounds.x;
  // Inside one staff system the playhead glides to the next note. At the end of
  // a line there is no next note on this line, so it keeps moving towards the
  // closing barline while slowing down, and switches lines with the next tick.
  if (nextBounds && Math.abs(nextBounds.systemTop - bounds.systemTop) < 1) {
    x = bounds.x + (nextBounds.x - bounds.x) * progress;
  } else if (bounds.lineEnd !== undefined && bounds.lineEnd > bounds.x) {
    // Paced by the beat itself (distance over beat length), so the slow-down
    // keeps the same relative timing at any tempo.
    const distance = bounds.lineEnd - bounds.x;
    x = bounds.x + distance * lineEndEase(progress);
  }
  return { bounds, next: nextBounds, progress, x };
}

/**
 * The staff system band that contains `systemTop` (the staff lines top of the
 * playhead). Single-line layouts show exactly this band.
 */
export function systemBand(score: VideoScore, systemTop: number | null): VideoSystem | null {
  const systems = score.systems;
  if (!systems || systems.length === 0) return null;
  if (systemTop === null || !Number.isFinite(systemTop)) return systems[0];
  for (const system of systems) {
    if (systemTop >= system.top - 1 && systemTop <= system.bottom + 1) return system;
  }
  // Bounds built from a restored lookup can be a little off; fall back to the
  // closest line rather than showing nothing.
  let nearest = systems[0];
  let best = Infinity;
  for (const system of systems) {
    const distance = Math.min(Math.abs(system.top - systemTop), Math.abs(system.bottom - systemTop));
    if (distance < best) {
      best = distance;
      nearest = system;
    }
  }
  return nearest;
}

export function scrollFor(cursor: CursorFrame | null, score: VideoScore, layout: VideoCanvasLayout, current: number): number {
  if (layout.horizontal) return 0;
  if (layout.singleLine) {
    // Center the staff lines of the active line in the frame. The anchor is the
    // middle of `lineAlignedBounds` (the staff lines of both the standard and
    // tab staves), not the top of the line's box: symbols above the staff must
    // not shift the notation from line to line.
    if (!cursor) return current;
    const staffCenter = cursor.bounds.systemTop + cursor.bounds.systemH / 2;
    return staffCenter * layout.scale - layout.scoreH / 2;
  }
  if (!cursor) return current;
  const target = cursor.bounds.systemTop * layout.scale + layout.scoreTop - layout.scoreH * 0.38;
  const max = Math.max(0, score.height * layout.scale - layout.scoreH + 10);
  return Math.min(max, Math.max(0, target));
}

/** Horizontal camera: keep the playhead centered once playback is under way. */
export function scrollXFor(cursor: CursorFrame | null, score: VideoScore, layout: VideoCanvasLayout, current = 0): number {
  if (!layout.horizontal) return 0;
  if (!cursor) return current;
  const target = cursor.x * layout.scale - layout.scoreW * 0.5;
  const max = Math.max(0, score.width * layout.scale - layout.scoreW + 10);
  return Math.min(max, Math.max(0, target));
}
