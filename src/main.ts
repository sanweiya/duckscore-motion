/**
 * Standalone shell for the score player.
 *
 * The UI lives in `../core` and is shared with the DSH plugin. This file
 * only provides what the plugin gets from its host: a React instance, a locale
 * dictionary and the asset locations.
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { bindReactRuntime } from '../core/runtime';
import { configureAssets, Player } from '../core/index';
import { DICTS } from '../core/i18n';

function resolveLocale(): Record<string, string> {
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (requested === 'en') return DICTS.en;
  if (requested === 'zh') return DICTS.zh;
  return window.navigator.language.toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en;
}

configureAssets(new URL('assets/', document.baseURI).href);

// The shared components create elements through this live binding.
bindReactRuntime(React);

const dictionary = resolveLocale();
const t = (key: string): string => dictionary[key] ?? key;

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing');

createRoot(container).render(React.createElement(Player, { t }));
