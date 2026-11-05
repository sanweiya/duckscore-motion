import type { AlphaTabApi } from '@coderline/alphatab';
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  canEncodeVideo,
} from 'mediabunny';
import {
  createCursorSmoothingState,
  cursorFor,
  cursorSmoothingLookahead,
  HORIZONTAL_CAMERA_FOLLOW,
  HORIZONTAL_CAMERA_LEAD_SMOOTH,
  layoutVideoCanvas,
  paintVideoFrame,
  scrollFor,
  scrollXFor,
  smoothCursorX,
  type CursorStyle,
  type VideoLayoutOptions,
  type VideoScore,
} from './video';
import type { ExportContainer, ExportQuality, ExportVideoCodec } from './studio-types';

export interface OfflineAudioSource {
  /** Blob URL for user-loaded external media. */
  url?: string;
  /** Embedded Guitar Pro backing track bytes. */
  bytes?: Uint8Array;
  offsetSec: number;
  /** Optional map from audio milliseconds to score milliseconds (GP sync points). */
  syncPoints?: { audioMs: number; scoreMs: number }[];
}

export interface OfflineExportOptions {
  api: AlphaTabApi;
  score: VideoScore;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  trackIndexes: Set<number>;
  trackLabel: string;
  accent: string;
  cursorStyle: CursorStyle;
  layout: VideoLayoutOptions;
  audio: OfflineAudioSource | null;
  /** Output container: WebM (VP9/VP8 + Opus) or MP4 (H.264/VP9 + AAC). */
  container: ExportContainer;
  /** Video codec as requested by the user; must be valid for the container. */
  videoCodec: ExportVideoCodec;
  /** Relative bitrate quality step. */
  quality: ExportQuality;
  onProgress(progress: number, phase: 'audio' | 'video' | 'finalize'): void;
  isCancelled(): boolean;
}

export interface OfflineExportResult {
  blob: Blob;
  mimeType: string;
  hasAudio: boolean;
}

export interface TickSegment {
  startTime: number;
  endTime: number;
  startTick: number;
  endTick: number;
}

const TICKS_PER_QUARTER = 960;
const AUDIO_RATE = 48000;
const AUDIO_CHUNK = 960;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Export failure carrying the i18n key the UI should show, so users never see
 * a raw English message (e.g. on browsers with partial WebCodecs support).
 */
export class OfflineExportError extends Error {
  constructor(message: string, readonly key: string) {
    super(message);
    this.name = 'OfflineExportError';
  }
}

/** Multipliers applied to the baseline bit rate derived from frame geometry. */
export const EXPORT_QUALITY_FACTORS: Record<ExportQuality, number> = { low: 0.4, normal: 1, high: 1.75 };

/**
 * Video codecs offered per container in the export dialog, in preference order,
 * plus each container's default codec.
 */
export const VIDEO_CODECS_BY_CONTAINER: Record<ExportContainer, ExportVideoCodec[]> = {
  webm: ['vp9', 'vp8'],
  mp4: ['avc', 'vp9'],
};
export const DEFAULT_VIDEO_CODEC: Record<ExportContainer, ExportVideoCodec> = { webm: 'vp9', mp4: 'avc' };

/** WebCodecs encoder codec strings to try per export codec, first supported wins. */
const VIDEO_ENCODER_CANDIDATES: Record<ExportVideoCodec, string[]> = {
  vp9: ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.10.08'],
  vp8: ['vp8'],
  // High profile first; the level steps cover 1080p60 through 4096px @ 60 fps.
  avc: ['avc1.64002a', 'avc1.640033', 'avc1.640034', 'avc1.4d002a', 'avc1.42002a', 'avc1.420034'],
};

/**
 * Baseline video bit rate in bits per second, before the quality factor. Kept
 * identical to the pre-Mediabunny heuristic. Notation scores are mostly static
 * line art, so even "lower" has generous headroom.
 */
function baselineVideoBitrate(width: number, height: number, fps: number): number {
  const pixels = width * height;
  return Math.round(Math.min(24_000_000, Math.max(2_000_000, pixels * (fps >= 50 ? 8 : 4.5))));
}

/** Effective video bit rate for a quality step, clamped to encoder-safe bounds. */
export function estimateVideoBitrate(width: number, height: number, fps: number, quality: ExportQuality): number {
  return Math.round(baselineVideoBitrate(width, height, fps) * EXPORT_QUALITY_FACTORS[quality]);
}

/** Capability probe used by the export dialog; true when this browser can encode `codec` at the target geometry. */
export async function videoCodecSupported(codec: ExportVideoCodec, width: number, height: number, fps: number): Promise<boolean> {
  if (!('VideoEncoder' in window)) return false;
  try {
    return await canEncodeVideo(codec, { width, height, frameRate: fps });
  } catch {
    return false;
  }
}

function ticksToMs(ticks: number, tempo: number): number {
  return ticks * 60_000 / (tempo * TICKS_PER_QUARTER);
}

/**
 * Builds a time -> MIDI tick map from alphaTab's playback lookup. Rendering
 * frames against this map lets the cursor move correctly without starting the
 * real-time player.
 */
export function buildTickSegments(api: AlphaTabApi, durationMs: number): TickSegment[] {
  const bars: any[] = (api as any).tickCache?.masterBars ?? [];
  const segments: TickSegment[] = [];
  let time = 0;
  for (const bar of bars) {
    const barStart = Number(bar.start) || 0;
    const barEnd = Number(bar.end) || barStart;
    if (barEnd <= barStart) continue;
    let tick = barStart;
    let tempo = Number(bar.tempoChanges?.[0]?.tempo) || 120;
    for (const change of bar.tempoChanges ?? []) {
      const changeTick = Math.max(barStart, Math.min(barEnd, Number(change.tick)));
      if (changeTick > tick) {
        const endTime = time + ticksToMs(changeTick - tick, tempo);
        segments.push({ startTime: time, endTime, startTick: tick, endTick: changeTick });
        time = endTime;
        tick = changeTick;
      }
      tempo = Number(change.tempo) || tempo;
    }
    if (tick < barEnd) {
      const endTime = time + ticksToMs(barEnd - tick, tempo);
      segments.push({ startTime: time, endTime, startTick: tick, endTick: barEnd });
      time = endTime;
    }
  }
  if (segments.length === 0 && durationMs > 0) {
    const tempo = Number((api as any).score?.tempo) || 120;
    const endTick = durationMs / (60_000 / (tempo * TICKS_PER_QUARTER));
    segments.push({ startTime: 0, endTime: durationMs, startTick: 0, endTick });
  }
  return segments;
}

/**
 * Length of the score in milliseconds according to its own tempo map (the
 * tempo automations of the master bars). This is the timeline used when a score
 * has no embedded audio: it needs no player, only alphaTab's tick lookup, so the
 * video workbench can be used before any sound has started.
 */
export function scoreTimelineMs(api: AlphaTabApi | null | undefined): number {
  if (!api) return 0;
  const segments = buildTickSegments(api, 0);
  return segments.length > 0 ? segments[segments.length - 1].endTime : 0;
}

export function tickAtTime(segments: TickSegment[], time: number): number {
  if (segments.length === 0) return 0;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].startTime <= time) low = mid;
    else high = mid - 1;
  }
  const segment = segments[low];
  const span = segment.endTime - segment.startTime;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (time - segment.startTime) / span)) : 0;
  return segment.startTick + (segment.endTick - segment.startTick) * ratio;
}

export interface AudioTimeline {
  durationMs: number;
  mapAudioToScore: ((audioMs: number) => number) | null;
}

export function buildAudioTimeline(audio: OfflineAudioSource | null): AudioTimeline {
  if (!audio?.syncPoints || audio.syncPoints.length < 2) {
    return { durationMs: 0, mapAudioToScore: null };
  }
  const points = audio.syncPoints
    .filter((point) => Number.isFinite(point.audioMs) && Number.isFinite(point.scoreMs))
    .sort((a, b) => a.audioMs - b.audioMs);
  if (points.length < 2) return { durationMs: 0, mapAudioToScore: null };
  const first = points[0];
  const last = points[points.length - 1];
  const durationMs = last.audioMs - first.audioMs;
  if (!(durationMs > 0) || last.scoreMs <= first.scoreMs) {
    return { durationMs: 0, mapAudioToScore: null };
  }
  return {
    durationMs,
    mapAudioToScore: (audioMs: number) => {
      const absolute = first.audioMs + Math.max(0, Math.min(durationMs, audioMs));
      let low = 0;
      let high = points.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (points[mid].audioMs <= absolute) low = mid;
        else high = mid - 1;
      }
      const current = points[low];
      const next = points[Math.min(points.length - 1, low + 1)];
      const span = next.audioMs - current.audioMs;
      const ratio = span > 0 ? Math.min(1, Math.max(0, (absolute - current.audioMs) / span)) : 0;
      return current.scoreMs + (next.scoreMs - current.scoreMs) * ratio;
    },
  };
}

/**
 * Renders the score into a 16-bit stereo WAV with alphaTab's synthesizer.
 *
 * Scores without a backing track still get a soundtrack in the exported video:
 * the audio is generated offline ("as fast as possible") at the tempo written
 * in the score (`useSyncPoints: false`), so picture and sound follow the same
 * timeline.
 */
export async function synthesizeScoreAudio(
  api: AlphaTabApi,
  soundFontUrl: string,
  onProgress?: (ratio: number) => void,
): Promise<{ bytes: Uint8Array; durationMs: number }> {
  const soundFonts: Uint8Array[] = [];
  try {
    const response = await fetch(soundFontUrl);
    if (response.ok) soundFonts.push(new Uint8Array(await response.arrayBuffer()));
  } catch {
    // Without a soundfont the synth still renders, just without instruments.
  }
  const expected = Math.max(1, scoreTimelineMs(api));
  const exporter = await (api as any).exportAudio({
    soundFonts,
    sampleRate: AUDIO_RATE,
    useSyncPoints: false,
    masterVolume: 1,
    metronomeVolume: 0,
    trackVolume: new Map(),
    trackTranspositionPitches: new Map(),
  });
  const chunks: Float32Array[] = [];
  let renderedMs = 0;
  try {
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const chunk = await exporter.render(4000);
      if (!chunk) break;
      chunks.push(chunk.samples);
      renderedMs = Number(chunk.endTime) || renderedMs;
      onProgress?.(Math.min(1, renderedMs / expected));
    }
  } finally {
    try { exporter.destroy(); } catch { /* already destroyed */ }
  }
  if (chunks.length === 0) {
    throw new OfflineExportError('The synthesizer returned no audio', 'export.midiAudioFailed');
  }
  const bytes = encodeWav(chunks, AUDIO_RATE, 2);
  // Duration from the samples themselves: independent of rounding in the
  // exported chunk metadata.
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0) / 2;
  return { bytes, durationMs: (frames / AUDIO_RATE) * 1000 };
}

/** Interleaved float samples -> 16-bit PCM WAV. */
function encodeWav(chunks: Float32Array[], sampleRate: number, channels: number): Uint8Array {
  const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const dataBytes = totalSamples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

/** Decodes external audio and renders exactly the requested excerpt to PCM. */
async function decodeAudio(options: OfflineExportOptions, durationMs: number): Promise<AudioBuffer | null> {
  if (!options.audio) return null;
  if (!('AudioContext' in window) || !('OfflineAudioContext' in window)) return null;
  let sourceContext: AudioContext | null = null;
  try {
    const data = options.audio.bytes
      ? options.audio.bytes.slice().buffer
      : await (await fetch(options.audio.url!)).arrayBuffer();
    sourceContext = new AudioContext();
    const decoded = await sourceContext.decodeAudioData(data);
    const frames = Math.max(1, Math.ceil(durationMs / 1000 * AUDIO_RATE));
    const offline = new OfflineAudioContext(2, frames, AUDIO_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    const offset = Math.max(0, options.audio.offsetSec || 0);
    if (offset < decoded.duration) {
      const available = Math.max(0, decoded.duration - offset);
      source.start(0, offset, Math.min(durationMs / 1000, available));
    }
    return await offline.startRendering();
  } catch {
    return null;
  } finally {
    if (sourceContext) {
      try { await sourceContext.close(); } catch { /* ignore */ }
    }
  }
}

type ExportAudioCodec = 'opus' | 'aac';

async function audioCodecSupported(codec: ExportAudioCodec): Promise<boolean> {
  if (!('AudioEncoder' in window) || !('AudioData' in window)) return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
      sampleRate: AUDIO_RATE,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

/** Audio codec for a container: MP4 prefers AAC (best player compatibility), falling back to Opus. */
async function chooseAudioCodec(container: ExportContainer): Promise<ExportAudioCodec | null> {
  if (container === 'webm') return (await audioCodecSupported('opus')) ? 'opus' : null;
  if (await audioCodecSupported('aac')) return 'aac';
  if (await audioCodecSupported('opus')) {
    // Opus inside MP4 is valid and plays in Chromium/Videolan/modern players,
    // just not in QuickTime. This is an edge case; log it for diagnosis.
    console.warn('[gp-studio] AAC encoding unavailable; mixing Opus into MP4');
    return 'opus';
  }
  return null;
}

async function encodeAudio(
  audioSource: EncodedAudioPacketSource,
  buffer: AudioBuffer,
  codec: ExportAudioCodec,
  isCancelled: () => boolean,
): Promise<void> {
  let encodeError: Error | null = null;
  // Muxer writes are async in Mediabunny; encoder outputs are collected and
  // drained in submission order so packets keep their sequence and memory
  // stays bounded.
  const pending: Promise<void>[] = [];
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      pending.push(audioSource.add(EncodedPacket.fromEncodedChunk(chunk), meta));
    },
    error: (error) => { encodeError = error; },
  });
  encoder.configure({
    codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: AUDIO_RATE,
    numberOfChannels: 2,
    bitrate: 128_000,
  });
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  try {
    for (let offset = 0; offset < buffer.length; offset += AUDIO_CHUNK) {
      if (isCancelled()) throw new Error('cancelled');
      if (encodeError) throw encodeError;
      const frames = Math.min(AUDIO_CHUNK, buffer.length - offset);
      const data = new Float32Array(frames * 2);
      data.set(left.subarray(offset, offset + frames), 0);
      data.set(right.subarray(offset, offset + frames), frames);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: AUDIO_RATE,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round(offset / AUDIO_RATE * 1_000_000),
        data,
      });
      try {
        encoder.encode(audioData);
      } finally {
        audioData.close();
      }
      while (encoder.encodeQueueSize > 8) await sleep(1);
      if (pending.length) await Promise.all(pending.splice(0));
    }
    await encoder.flush();
    if (pending.length) await Promise.all(pending.splice(0));
  } finally {
    // Release the encoder even when the export was cancelled or failed:
    // a configured AudioEncoder otherwise pins its resources until GC.
    try { encoder.close(); } catch { /* already closed */ }
  }
  if (encodeError) throw encodeError;
}

async function chooseEncoderCodec(videoCodec: ExportVideoCodec, width: number, height: number, fps: number, bitrate: number): Promise<string> {
  if (!('VideoEncoder' in window)) {
    throw new OfflineExportError('WebCodecs VideoEncoder is unavailable', 'export.webcodecsUnavailable');
  }
  for (const encoderCodec of VIDEO_ENCODER_CANDIDATES[videoCodec]) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: encoderCodec,
        width,
        height,
        framerate: fps,
        bitrate,
      });
      if (support.supported) return encoderCodec;
    } catch { /* try the next profile */ }
  }
  throw new OfflineExportError(
    `This browser cannot encode ${videoCodec.toUpperCase()} video`,
    'export.codecUnsupported',
  );
}

/** Render every frame deterministically, then mux it to WebM with WebCodecs. */
export async function renderOfflineVideo(options: OfflineExportOptions): Promise<OfflineExportResult> {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window) || typeof document === 'undefined') {
    throw new OfflineExportError('Offline video encoding is unavailable', 'export.webcodecsUnavailable');
  }
  if (!(options.durationMs > 0)) {
    throw new OfflineExportError('The score is not ready for export', 'export.notReady');
  }
  if (!options.score.tiles.length) {
    throw new OfflineExportError('The score has no renderable content', 'export.noContent');
  }

  const audioTimeline = buildAudioTimeline(options.audio);
  const timelineDurationMs = audioTimeline.durationMs > 0 ? audioTimeline.durationMs : options.durationMs;
  options.onProgress(4, 'audio');
  const pcm = await decodeAudio(options, timelineDurationMs);
  const audioCodec = pcm ? await chooseAudioCodec(options.container) : null;
  const withAudio = !!audioCodec;
  if (options.isCancelled()) throw new Error('cancelled');
  options.onProgress(10, 'video');

  const bitsPerSecond = estimateVideoBitrate(options.width, options.height, options.fps, options.quality);
  const encoderString = await chooseEncoderCodec(options.videoCodec, options.width, options.height, options.fps, bitsPerSecond);

  const target = new BufferTarget();
  const output = new Output({
    format: options.container === 'mp4'
      // fastStart in memory ships the index in front of the media data, so the
      // file starts playing while downloading.
      ? new Mp4OutputFormat({ fastStart: 'in-memory' })
      : new WebMOutputFormat(),
    target,
  });
  const videoSource = new EncodedVideoPacketSource(options.videoCodec);
  output.addVideoTrack(videoSource, { frameRate: options.fps });
  const audioSource = new EncodedAudioPacketSource(withAudio ? audioCodec! : 'opus');
  if (withAudio) output.addAudioTrack(audioSource);
  await output.start();
  // Guard the whole write phase: any abort (cancel, codec error, renderer
  // setup failure) must call output.cancel() so the writer never lingers.
  let outputCompleted = false;
  try {

  if (pcm && withAudio && audioCodec) {
    await encodeAudio(audioSource, pcm, audioCodec, options.isCancelled);
    if (options.isCancelled()) throw new Error('cancelled');
  }

  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new OfflineExportError('Canvas 2D context unavailable', 'export.canvasUnavailable');
  const layout = layoutVideoCanvas(options.width, options.height, options.score, options.layout);
  if (!(options.api as any).tickCache && typeof (options.api as any).loadMidiForScore === 'function') {
    try { (options.api as any).loadMidiForScore(); } catch { /* fall back to score tempo */ }
  }
  const segments = buildTickSegments(options.api, options.durationMs);
  const frameCount = Math.max(1, Math.ceil(timelineDurationMs / 1000 * options.fps));
  let encodeError: Error | null = null;
  // Same ordered async drain as the audio path: encoder outputs are collected
  // into the packet source and awaited per iteration to keep packet sequence
  // and memory bounded.
  const pending: Promise<void>[] = [];
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      pending.push(videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta));
    },
    error: (error) => { encodeError = error; },
  });
  encoder.configure({
    codec: encoderString,
    width: options.width,
    height: options.height,
    framerate: options.fps,
    bitrate: bitsPerSecond,
  });

  let scrollY = 0;
  let scrollX = 0;
  let lastCursorPx: number | null = null;
  let lastSystemTop: number | undefined;
  let leadVelocity = 0;
  const cursorSmoothingState = createCursorSmoothingState();
  const smoothingAmount = Math.min(1, Math.max(0, options.cursorStyle.smoothing ?? 0));
  // Keyframe interval in whole frames (~2 s). Rounding matters for fractional
  // frame rates (23.976/29.97/59.94): a fractional modulus would only hit zero
  // once every 50-250 s, producing a near-unseekable file.
  const gopFrames = Math.max(1, Math.round(options.fps * 2));
  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      if (options.isCancelled()) throw new Error('cancelled');
      if (encodeError) throw encodeError;
      const time = Math.min(timelineDurationMs, frameIndex / options.fps * 1000);
      const scoreTime = audioTimeline.mapAudioToScore ? audioTimeline.mapAudioToScore(time) : time;
      const tick = tickAtTime(segments, Math.min(options.durationMs, scoreTime));
      const cursor = cursorFor(options.api, options.score.beats, options.trackIndexes, tick);
      // Presentation-only damping, identical to the studio preview: the frame
      // time and the soundtrack keep their original timing.
      let paintCursor = cursor;
      let cursorPx = cursor ? cursor.x * layout.scale : null;
      if (layout.horizontal && cursor && smoothingAmount > 0.001) {
        // Same lookahead as the preview: sample the score a little in advance so
        // the damping does not push the whole picture behind the soundtrack.
        let sample = cursor;
        const lookaheadMs = cursorSmoothingLookahead(smoothingAmount, options.cursorStyle.lookahead) * 1000;
        if (lookaheadMs > 0.5) {
          const ahead = cursorFor(
            options.api,
            options.score.beats,
            options.trackIndexes,
            tickAtTime(segments, Math.min(options.durationMs, scoreTime + lookaheadMs)),
          );
          if (ahead && Math.abs(ahead.bounds.systemTop - cursor.bounds.systemTop) < 1) sample = ahead;
        }
        const steadyPx = smoothCursorX(
          cursorSmoothingState,
          sample.x * layout.scale,
          cursor.bounds.systemTop,
          1 / options.fps,
          smoothingAmount,
          layout.scoreW * 0.6,
          cursorPx,
        );
        if (steadyPx !== null) {
          cursorPx = steadyPx;
          paintCursor = { ...cursor, x: layout.scale > 0 ? steadyPx / layout.scale : cursor.x };
        }
      }
      const targetScrollY = scrollFor(cursor, options.score, layout, scrollY);
      const targetScrollX = scrollXFor(paintCursor, options.score, layout, scrollX);
      const maxScrollX = Math.max(0, options.score.width * layout.scale - layout.scoreW + 10);
      const verticalSmoothing = 1 - Math.exp(-5.5 / options.fps);
      const horizontalSmoothing = 1 - Math.exp(-HORIZONTAL_CAMERA_FOLLOW / options.fps);
      if (layout.horizontal) {
        let target = targetScrollX;
        if (lastCursorPx !== null && cursorPx !== null && targetScrollX > 0 && targetScrollX < maxScrollX) {
          const rawVelocity = (cursorPx - lastCursorPx) * options.fps;
          leadVelocity += (rawVelocity - leadVelocity)
            * (1 - Math.exp(-HORIZONTAL_CAMERA_LEAD_SMOOTH / options.fps));
          target += leadVelocity / HORIZONTAL_CAMERA_FOLLOW;
        }
        target = Math.min(maxScrollX, Math.max(0, target));
        if (frameIndex === 0) {
          scrollX = target;
          leadVelocity = 0;
        } else {
          scrollX += (target - scrollX) * horizontalSmoothing;
        }
        scrollY = 0;
        lastCursorPx = cursorPx;
      } else if (layout.singleLine) {
        // Single-line page: the camera is pinned to the active line, so a line
        // change is an instant cut - vertically and horizontally.
        scrollY = targetScrollY;
        scrollX = targetScrollX;
      } else if (frameIndex === 0) {
        scrollY = targetScrollY;
        scrollX = 0;
      } else {
        scrollY += (targetScrollY - scrollY) * verticalSmoothing;
        scrollX = 0;
      }
      if (paintCursor) lastSystemTop = paintCursor.bounds.systemTop;
      paintVideoFrame(context, options.score, layout, {
        scrollY,
        scrollX,
        cursor: paintCursor,
        systemTop: lastSystemTop,
        accent: options.accent,
        cursorStyle: options.cursorStyle,
        trackLabel: options.trackLabel,
      });
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(frameIndex * 1_000_000 / options.fps),
        duration: Math.round(1_000_000 / options.fps),
      });
      try {
        encoder.encode(frame, { keyFrame: frameIndex % gopFrames === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > 8) await sleep(1);
      if (pending.length) await Promise.all(pending.splice(0));
      if (frameIndex % 6 === 0) {
        options.onProgress(12 + (frameIndex / frameCount) * 82, 'video');
        await sleep(0);
      }
    }
    options.onProgress(95, 'finalize');
    await encoder.flush();
    if (pending.length) await Promise.all(pending.splice(0));
  } finally {
    // Release the encoder even when the export was cancelled or failed:
    // a configured VideoEncoder otherwise pins its (possibly hardware) session
    // until GC.
    try { encoder.close(); } catch { /* already closed */ }
  }
  if (encodeError) throw encodeError;
  if (options.isCancelled()) throw new Error('cancelled');
  await output.finalize();
  outputCompleted = true;

  } finally {
    if (!outputCompleted) {
      // Abort the muxer so a cancelled/failed export never leaves a half-open
      // writer in the background.
      try { await output.cancel(); } catch { /* already gone */ }
    }
  }
  const muxerBuffer = target.buffer;
  const mimeType = options.container === 'mp4' ? 'video/mp4' : 'video/webm';
  if (!muxerBuffer || muxerBuffer.byteLength === 0) {
    throw new OfflineExportError('Encoded video is empty', 'export.emptyOutput');
  }
  const blob = new Blob([muxerBuffer], { type: mimeType });
  if (blob.size === 0) {
    throw new OfflineExportError('Encoded video is empty', 'export.emptyOutput');
  }
  options.onProgress(100, 'finalize');
  return { blob, mimeType, hasAudio: withAudio };
}
