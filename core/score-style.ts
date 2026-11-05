import * as alphaTab from '@coderline/alphatab';

export type FontKey = 'title' | 'subtitle' | 'info' | 'lyrics' | 'chords' | 'effects' | 'tab' | 'tabGrace' | 'barNumber';

export interface FontOverride {
  family?: string;
  size?: number;
}

export interface ScoreColors {
  main: string;
  staff: string;
  bar: string;
  barNumber: string;
  info: string;
}

export const DEFAULT_SCORE_COLORS: ScoreColors = {
  main: '#211d17',
  staff: '#8f8473',
  bar: '#5e5549',
  barNumber: '#887d6c',
  info: '#211d17',
};

/**
 * Notation colours for the dark video theme: white notes on black paper.
 * Staff lines stay slightly dimmer than the notes so the staff does not
 * outshine the music.
 */
export const DARK_SCORE_COLORS: ScoreColors = {
  main: '#ffffff',
  staff: '#c9d3e0',
  bar: '#aab6c5',
  barNumber: '#ffffff',
  info: '#ffffff',
};

/** Notation palette for a studio theme; light keeps the score's own colours. */
export function scoreColorsForTheme(theme: 'light' | 'dark', colors: ScoreColors): ScoreColors {
  return theme === 'dark' ? DARK_SCORE_COLORS : colors;
}

export function scoreColor(hex: string): alphaTab.model.Color {
  const value = hex.replace('#', '');
  const parsed = value.length === 3
    ? value.split('').map((part) => Number.parseInt(part + part, 16))
    : [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
  const [r, g, b] = parsed.every((part) => Number.isFinite(part)) ? parsed : [33, 29, 23];
  return new alphaTab.model.Color(r, g, b, 255);
}

export const FONT_KEYS: FontKey[] = ['title', 'subtitle', 'info', 'lyrics', 'chords', 'effects', 'tab', 'tabGrace', 'barNumber'];

/** Groups of alphaTab notation elements that share one user-facing font control. */
const FONT_ELEMENT_IDS: Record<Exclude<FontKey, 'tab' | 'tabGrace'>, number[]> = {
  title: [0],
  subtitle: [1],
  info: [2, 3, 4, 5, 6, 7, 8, 9],
  lyrics: [24],
  // 10 = ChordDiagrams, 16 = EffectChordNames, 25 = EffectMarker, 52 = ChordDiagramFretboardNumbers.
  // The control is labelled "Chords & markers" / 「和弦与标记」, so EffectMarker
  // deliberately follows the same override.
  chords: [10, 16, 25, 52],
  // NotationElement ids verified against alphaTab 1.9.0 (enum max = EffectHammerOnPullOffText = 56).
  effects: [14, 15, 17, 18, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 54, 55, 56],
  barNumber: [53],
};

/**
 * Second voice colours are the main notation colour with a reduced opacity, so
 * the second voice stays readable on any surface (dark themes need light notes,
 * not the near-black default). `base` is the theme's main glyph colour.
 */
export function secondaryVoiceColor(
  value: number,
  base: string | alphaTab.model.Color = DEFAULT_SCORE_COLORS.main,
): alphaTab.model.Color {
  const color = typeof base === 'string' ? scoreColor(base) : base;
  return new alphaTab.model.Color(color.r, color.g, color.b, Math.round(Math.min(100, Math.max(20, value)) * 2.55));
}

function parseFamilies(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function withOverride(base: alphaTab.model.Font, override: FontOverride): alphaTab.model.Font {
  const families = override.family?.trim() ? parseFamilies(override.family) : base.families;
  const size = override.size && override.size > 0 ? override.size : base.size;
  return alphaTab.model.Font.withFamilyList(families.length > 0 ? families : base.families, size, base.style, base.weight);
}

/** Applies user font overrides to a live alphaTab API (screen and video export). */
export function applyFontOverrides(
  api: alphaTab.AlphaTabApi,
  fonts: Partial<Record<FontKey, FontOverride>> | undefined,
): void {
  const resources = api?.settings?.display?.resources;
  if (!resources || !fonts) return;
  for (const key of FONT_KEYS) {
    const override = fonts[key];
    if (!override || (!override.family?.trim() && !override.size)) continue;
    if (key === 'tab') {
      resources.tablatureFont = withOverride(resources.tablatureFont, override);
      // Follow the tablature family for the small grace numbers unless they
      // have a family of their own; the smaller size is kept either way.
      if (override.family?.trim() && !fonts.tabGrace?.family?.trim()) {
        resources.graceFont = withOverride(resources.graceFont, { family: override.family });
      }
      continue;
    }
    // Tablature grace/small numbers, bend labels and trill notes use their own
    // (smaller) font, so they need a separate control.
    if (key === 'tabGrace') {
      resources.graceFont = withOverride(resources.graceFont, override);
      continue;
    }
    for (const id of FONT_ELEMENT_IDS[key]) {
      const base = resources.elementFonts.get(id) ?? resources.elementFonts.get(4);
      if (base) resources.elementFonts.set(id, withOverride(base, override));
    }
  }
}
