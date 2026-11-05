/** Scoped styles for the score player; every chrome color comes from a host theme token. */
export const CSS = `
.gsp-root {
  container-type: inline-size;
  --gsp-paper: #fbfbf9;
  --gsp-ink: #221e18;
  --gsp-accent: #436d9d;
  --gsp-accent-hover: #5588c7;
  --gsp-accent-ink: color-mix(in srgb, var(--gsp-accent) 72%, var(--dsw-alias-label-primary));
  --gsp-accent-soft: rgba(67, 109, 157, .14);
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font: 13px/1.42 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.gsp-root *, .gsp-root *::before, .gsp-root *::after { box-sizing: border-box; }
.gsp-root button, .gsp-root input, .gsp-root select { font: inherit; color: inherit; }
.gsp-root button { cursor: pointer; }
.gsp-root button:disabled { cursor: default; opacity: .45; }

.gsp-header {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
.gsp-mark {
  width: 30px; height: 30px; border-radius: 9px; flex: none;
  display: grid; place-items: center;
  color: #fff8ec; background: #1c1a16;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
}
.gsp-title-wrap { min-width: 0; flex: 1; }
.gsp-eyebrow {
  font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary); font-weight: 650;
}
.gsp-file-name {
  margin-top: 1px; font-weight: 650; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gsp-header-actions { display: flex; align-items: center; gap: 4px; flex: none; }

.gsp-icon-btn {
  appearance: none; border: 1px solid transparent; background: transparent;
  width: 28px; height: 28px; border-radius: 7px; padding: 0;
  display: inline-grid; place-items: center; color: var(--dsw-alias-label-secondary);
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
.gsp-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gsp-icon-btn:focus-visible, .gsp-btn:focus-visible, .gsp-play:focus-visible {
  outline: 2px solid var(--gsp-accent); outline-offset: 2px;
}
.gsp-icon-btn.is-active { color: var(--gsp-accent-ink); background: var(--gsp-accent-soft); border-color: color-mix(in srgb, var(--gsp-accent) 30%, transparent); }

.gsp-btn {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  min-height: 28px; padding: 0 10px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: background .12s ease, border-color .12s ease, transform .12s ease;
}
.gsp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.gsp-btn:active:not(:disabled) { transform: translateY(1px); }
.gsp-btn.is-primary { background: var(--gsp-accent); border-color: transparent; color: #fff; }
.gsp-btn.is-primary:hover:not(:disabled) {
  background: var(--gsp-accent-hover); border-color: transparent; color: #fff;
  filter: none;
}
.gsp-btn.is-danger { color: var(--dsw-alias-state-error-primary); }
.gsp-btn.is-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.gsp-btn.is-ghost:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gsp-btn.is-small { min-height: 24px; padding: 0 8px; font-size: 11px; }

.gsp-transport {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px 6px;
  flex: none; flex-wrap: wrap;
}
.gsp-play {
  width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0;
  display: grid; place-items: center; background: var(--gsp-accent); color: #fff;
  box-shadow: 0 5px 14px rgba(67,109,157,.28);
  flex: none;
}
.gsp-play:hover:not(:disabled) { filter: brightness(1.05); }
.gsp-time {
  font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary);
  font-size: 11px; white-space: nowrap; min-width: 78px;
}
.gsp-time strong { color: var(--dsw-alias-label-primary); font-weight: 650; }
.gsp-spacer { flex: 1; }
.gsp-speed {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); border-radius: 6px;
  height: 24px; padding: 0 4px; font-size: 11px; color: var(--dsw-alias-label-secondary);
}
.gsp-toggle {
  appearance: none; border: 1px solid transparent; background: transparent;
  height: 24px; border-radius: 6px; padding: 0 6px; font-size: 11px; font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.gsp-toggle:hover { background: var(--dsw-alias-bg-layer-2); }
.gsp-toggle.is-on { color: var(--gsp-accent-ink); background: var(--gsp-accent-soft); }

.gsp-timeline { padding: 0 12px 7px; flex: none; }
.gsp-range {
  width: 100%; height: 18px; margin: 0; cursor: pointer;
  appearance: none; background: transparent;
}
.gsp-range:disabled { cursor: default; opacity: .5; }
.gsp-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 999px;
  background: color-mix(in srgb, var(--gsp-accent) 34%, var(--dsw-alias-border-l2));
}
.gsp-range::-webkit-slider-thumb {
  appearance: none; width: 14px; height: 14px; border-radius: 50%;
  margin-top: -5px; background: var(--gsp-accent); border: 2px solid var(--dsw-alias-bg-base);
  box-shadow: 0 1px 4px rgba(0,0,0,.22);
}
.gsp-range::-moz-range-track {
  height: 4px; border-radius: 999px;
  background: color-mix(in srgb, var(--gsp-accent) 34%, var(--dsw-alias-border-l2));
}
.gsp-range::-moz-range-progress { height: 4px; border-radius: 999px; background: var(--gsp-accent); }
.gsp-range::-moz-range-thumb {
  width: 12px; height: 12px; border-radius: 50%; background: var(--gsp-accent);
  border: 2px solid var(--dsw-alias-bg-base);
}

.gsp-actionbar {
  display: flex; align-items: center; gap: 5px; padding: 0 12px 8px;
  flex: none; flex-wrap: wrap; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.gsp-action {
  appearance: none; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); height: 27px; padding: 0 9px;
  border-radius: 7px; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary);
}
.gsp-action:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.gsp-action.is-open { border-color: color-mix(in srgb, var(--gsp-accent) 45%, transparent); color: var(--gsp-accent-ink); }
.gsp-action .gsp-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gsp-accent); }
.gsp-action .gsp-dot.is-muted { background: var(--dsw-alias-state-idle-primary); }

.gsp-panel {
  flex: none; max-height: 48%; overflow: auto; padding: 10px 12px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.gsp-panel-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.gsp-panel-title { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); flex: 1; }
.gsp-field { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; gap: 8px; margin: 7px 0; }
.gsp-field > label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.gsp-field-value { font-variant-numeric: tabular-nums; font-size: 11px; color: var(--dsw-alias-label-secondary); justify-self: end; margin-top: -20px; pointer-events: none; }
.gsp-select:focus, .gsp-input:focus { outline: none; border-color: var(--gsp-accent); box-shadow: 0 0 0 2px var(--gsp-accent-soft); }
.gsp-select, .gsp-input {
  width: 100%; height: 28px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base); padding: 0 7px; font-size: 12px;
}
.gsp-input[type="number"] { max-width: 96px; }
.gsp-hint { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; margin: 7px 0; }
.gsp-hint code { font-size: 10.5px; background: var(--dsw-alias-bg-layer-2); padding: 1px 4px; border-radius: 4px; }
/* A hint placed inside a two-column field must span both columns instead of
   being squeezed into the narrow label column. */
.gsp-field > .gsp-hint { grid-column: 1 / -1; margin: 2px 0 0; }
.gsp-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--dsw-alias-bg-layer-2); border-radius: 8px; }
.gsp-seg button {
  appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  height: 24px; padding: 0 8px; border-radius: 6px; font-size: 11px; font-weight: 600;
}
.gsp-seg button.is-on { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.gsp-inline { display: flex; align-items: center; gap: 6px; min-width: 0; }
.gsp-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.gsp-check input { accent-color: var(--gsp-accent); }
.gsp-chip {
  display: inline-flex; align-items: center; gap: 5px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 10.5px; font-weight: 600; padding: 3px 8px; white-space: nowrap;
}
.gsp-chip.is-accent { color: var(--gsp-accent-ink); background: var(--gsp-accent-soft); }

.gsp-score-scroll {
  position: relative; flex: 1 1 auto; min-height: 0; overflow: auto;
  background: var(--gsp-paper);
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.gsp-alpha { width: 100%; min-height: 220px; }
.gsp-alpha .at-surface { margin: 0 auto; }
/* alphaTab does not ship cursor styling; without it the playback cursor divs stay invisible. */
.gsp-alpha .at-cursors { pointer-events: none; }
.gsp-alpha .at-cursor-bar { background: transparent; }
.gsp-alpha .at-cursor-beat { width: 200px !important; background: var(--gsp-accent); box-shadow: 0 0 0 1px rgba(255,255,255,.45); }
.gsp-alpha .at-selection div { background: rgba(67, 109, 157, .16); }
.gsp-score-pad { padding: 6px 8px 18px; }

.gsp-empty {
  min-height: 260px; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center; gap: 10px;
  padding: 28px 22px; color: #5f6d7c;
}
.gsp-empty.is-drag { background: var(--gsp-accent-soft); outline: 2px dashed var(--gsp-accent); outline-offset: -8px; }
.gsp-empty-icon {
  width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--gsp-accent) 7%, #fff); border: 1px solid color-mix(in srgb, var(--gsp-accent) 20%, transparent);
  color: var(--gsp-accent); box-shadow: 0 8px 24px rgba(67,109,157,.10);
}
.gsp-empty h3 { margin: 2px 0 0; color: #243447; font-size: 15px; }
.gsp-empty p { margin: 0; max-width: 300px; font-size: 12px; line-height: 1.55; }
.gsp-empty .gsp-chip { background: rgba(67,109,157,.09); color: #5f6d7c; }
.gsp-empty-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }

.gsp-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  gap: 9px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 72%, transparent);
  color: var(--dsw-alias-label-secondary); font-size: 12px; z-index: 3;
}
.gsp-spinner {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--gsp-accent); animation: gsp-spin .8s linear infinite;
}
@keyframes gsp-spin { to { transform: rotate(360deg); } }

.gsp-error {
  margin: 8px 12px 0; padding: 8px 10px; border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary); font-size: 11.5px; line-height: 1.45;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent);
  flex: none;
}
.gsp-statusbar {
  flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 12px; border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 10.5px; min-height: 29px;
  background: var(--dsw-alias-bg-base);
}
.gsp-statusbar .gsp-spacer { min-width: 4px; }
.gsp-status-link { color: inherit; text-decoration: none; }
.gsp-status-link:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }


/* Playground-style stage, side panels and bottom player bar. */
.gsp-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; }
.gsp-stage .gsp-score-scroll { position: absolute; inset: 0; }
.gsp-stage > .gsp-error { position: absolute; left: 10px; right: 10px; top: 8px; z-index: 1005; margin: 0; }

.gsp-progress { position: relative; flex: none; height: 4px; background: #d9d9d9; overflow: hidden; }
.gsp-progress-fill { display: block; height: 100%; width: 0; background: #6ba5e4; transition: width .08s linear; }
.gsp-progress-input {
  position: absolute; inset: -5px 0; width: 100%; height: 14px; margin: 0; opacity: 0; cursor: pointer;
}
.gsp-progress-input:disabled { cursor: default; }

.gsp-player {
  flex: none; min-height: 48px; display: flex; align-items: stretch; justify-content: space-between;
  background: #436d9d; color: #fff; font-size: 12px;
}
.gsp-player-left, .gsp-player-right { display: flex; align-items: stretch; min-width: 0; }
.gsp-player-left { flex: 1 1 auto; }
.gsp-player-right { flex: none; }
.gsp-player-btn {
  appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer;
  min-height: 48px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-size: 12px; font-weight: 600; white-space: nowrap;
  transition: background .15s ease;
}
.gsp-player-btn:hover:not(:disabled), .gsp-player-btn.is-active { background: #5588c7; }
.gsp-player-btn:disabled { opacity: .45; cursor: default; }
.gsp-player-btn.is-play { padding-inline: 12px; }
/* The video studio is the main working surface, so its entry is the one solid
   button in the blue transport bar. */
.gsp-player-btn.is-cta {
  align-self: center; min-height: 34px;
  background: #ffffff; color: #26527f; border-radius: 9px; margin-inline: 8px 6px;
  padding-inline: 13px; box-shadow: 0 2px 9px rgba(12, 32, 53, .28);
}
.gsp-player-btn.is-cta:hover:not(:disabled) { background: #e8f1fb; color: #1d4368; }
.gsp-player-btn.is-cta .gsp-player-label { font-weight: 800; letter-spacing: .01em; }
.gsp-cta-wide { width: 100%; margin-top: 6px; }
@media (max-width: 640px) {
  .gsp-player-btn.is-cta .gsp-player-label { display: inline; }
}
.gsp-player-btn.is-play svg { width: 19px; height: 19px; }
.gsp-player-spinner {
  width: 15px; height: 15px; align-self: center; margin: 0 8px; flex: none;
  border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%;
  animation: gsp-spin .8s linear infinite;
}
.gsp-song { flex: 0 1 auto; min-width: 0; max-width: 46%; display: flex; align-items: center; padding: 0 10px; overflow: hidden; }
.gsp-song strong { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsp-song span { opacity: .82; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsp-player-time { flex: none; display: flex; align-items: center; padding: 0 10px 0 2px; font-variant-numeric: tabular-nums; white-space: nowrap; opacity: .95; }
.gsp-player .gsp-dot { width: 6px; height: 6px; border-radius: 50%; background: #b9f0c9; flex: none; }
.gsp-player .gsp-dot.is-muted { background: rgba(255,255,255,.4); }

.gsp-side {
  position: absolute; top: 8px; right: 8px; bottom: 8px; z-index: 1010;
  width: min(336px, calc(100% - 16px)); display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  border: 1px solid color-mix(in srgb, var(--gsp-accent) 22%, var(--dsw-alias-border-l2)); border-radius: 11px;
  box-shadow: 0 18px 48px rgba(0,0,0,.26); overflow: hidden;
  animation: gsp-side-in .18s ease-out;
}
@keyframes gsp-side-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: none; } }
.gsp-side-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: color-mix(in srgb, var(--gsp-accent) 8%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--gsp-accent) 22%, var(--dsw-alias-border-l1)); }
.gsp-side-head h3 { margin: 0; flex: 1; font-size: 13px; font-weight: 700; color: var(--gsp-accent-ink); }
.gsp-side-close {
  appearance: none; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary);
  width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; cursor: pointer;
}
.gsp-side-close:hover { background: var(--gsp-accent-soft); color: var(--gsp-accent-ink); }
.gsp-side-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 12px 14px; }
.gsp-side-foot { flex: none; padding: 7px 12px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10px; color: var(--dsw-alias-label-secondary); }
.gsp-side-foot a { color: inherit; text-decoration: none; }
.gsp-side-foot a:hover { color: var(--gsp-accent-ink); text-decoration: underline; }
.gsp-group { padding: 9px 0 11px; border-bottom: 1px dashed color-mix(in srgb, var(--gsp-accent) 18%, var(--dsw-alias-border-l2)); }
.gsp-group:last-child { border-bottom: 0; }
.gsp-group h4 {
  margin: 0 0 4px; font-size: 10px; font-weight: 750; letter-spacing: .09em;
  text-transform: uppercase; color: var(--dsw-alias-label-secondary);
}
.gsp-side .gsp-field { grid-template-columns: 78px minmax(0, 1fr); gap: 7px; margin: 8px 0; }
.gsp-side .gsp-field > label { font-size: 11.5px; }
.gsp-side .gsp-check { font-size: 11.5px; }
.gsp-side input[type="range"], .gsp-track-volume input[type="range"] { width: 100%; min-width: 0; accent-color: var(--gsp-accent); }
.gsp-value { flex: none; width: 36px; text-align: right; font-size: 10.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.gsp-pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.gsp-pill {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary); border-radius: 7px; min-height: 27px; padding: 0 8px;
  display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
}
.gsp-pill.is-on { color: var(--gsp-accent-ink); background: var(--gsp-accent-soft); border-color: color-mix(in srgb, var(--gsp-accent) 30%, transparent); }
.gsp-pill:disabled { opacity: .45; cursor: default; }

.gsp-color { width: 100%; height: 27px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); cursor: pointer; }
.gsp-color::-webkit-color-swatch-wrapper { padding: 0; }
.gsp-color::-webkit-color-swatch { border: 0; border-radius: 4px; }
.gsp-track { padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 8px; align-items: center; }
.gsp-track:last-child { border-bottom: 0; }
.gsp-track-main { appearance: none; border: 0; background: transparent; color: inherit; padding: 0; display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; text-align: left; font: inherit; font-size: 12px; font-weight: 600; }
.gsp-track-dot { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--dsw-alias-border-l2); flex: none; }
.gsp-track.is-active { background: color-mix(in srgb, var(--gsp-accent) 7%, transparent); border-radius: 7px; padding-inline: 6px; }
.gsp-track.is-active .gsp-track-dot { border-color: var(--gsp-accent); background: var(--gsp-accent); box-shadow: 0 0 0 3px var(--gsp-accent-soft); }
.gsp-track-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gsp-track-actions { display: flex; gap: 4px; }
.gsp-mini {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary); width: 25px; height: 24px; border-radius: 5px;
  font: inherit; font-size: 10.5px; font-weight: 750; cursor: pointer;
}
.gsp-mini.is-on { color: #fff; background: var(--gsp-accent); border-color: transparent; }
.gsp-track-volume { grid-column: 1 / -1; display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); }
.gsp-track-volume svg { flex: none; }

@container (max-width: 820px) {
  .gsp-player-label { display: none; }
  .gsp-player-btn { padding-inline: 8px; }
  .gsp-song { padding-inline: 7px; }
  .gsp-player-time { padding-inline: 4px; font-size: 11px; }
}
@container (max-width: 460px) {
  .gsp-player-time { display: none; }
  .gsp-player-btn { padding-inline: 6px; }
  .gsp-side .gsp-field { grid-template-columns: 70px minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .gsp-player-label { display: none; }
  .gsp-player-btn { padding-inline: 8px; }
  .gsp-song { padding-inline: 7px; }
  .gsp-player-time { padding-inline: 4px; font-size: 11px; }
}
@media (max-width: 390px) {
  .gsp-player-time { display: none; }
  .gsp-side .gsp-field { grid-template-columns: 70px minmax(0, 1fr); }
}

.gsp-media-holder { position: absolute; width: 1px; height: 1px; left: -9999px; top: 0; overflow: hidden; opacity: 0; pointer-events: none; }

.gsp-overlay {
  position: absolute; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center;
  padding: 18px; background: color-mix(in srgb, #14110d 48%, transparent);
  backdrop-filter: blur(3px);
}
.gsp-modal {
  width: min(100%, 340px); border-radius: 14px; padding: 16px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 24px 70px rgba(0,0,0,.32);
}
.gsp-modal h3 { margin: 0 0 4px; font-size: 14px; }
.gsp-modal p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.gsp-big-progress { height: 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin: 13px 0 8px; }
.gsp-big-progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--gsp-accent), #6ba5e4); transition: width .25s linear; }
.gsp-modal-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 14px; }
.gsp-export-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.gsp-rec-dot { width: 7px; height: 7px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 3px rgba(229,72,77,.16); }

.gsp-toast {
  position: absolute; left: 12px; right: 12px; bottom: 62px; z-index: 1200;
  padding: 9px 11px; border-radius: 9px; font-size: 11.5px; line-height: 1.45;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 10px 30px rgba(0,0,0,.18); color: var(--dsw-alias-label-primary);
}
.gsp-toast.is-error { color: var(--dsw-alias-state-error-primary); }
.gsp-toast.is-success { color: var(--dsw-alias-state-success-primary); }
.gsp-toast button { margin-left: 6px; }

.gsp-divider { width: 1px; height: 18px; background: var(--dsw-alias-border-l1); margin: 0 2px; }
.gsp-num { font-variant-numeric: tabular-nums; }
.gsp-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}

.gsp-studio-layer { position: absolute; inset: 0; z-index: 1050; background: #e9eff6; overflow: hidden; }
.gsp-root.is-studio > .gsp-stage,
.gsp-root.is-studio > .gsp-progress,
.gsp-root.is-studio > .gsp-player { visibility: hidden; }

/* Video studio: same blue chrome as the player bar, with a live export preview. */
.gsp-root.is-studio { background: #e9eff6; }
.gsp-studio:focus { outline: none; }
.gsp-studio {
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;
  background:
    radial-gradient(circle at 18% 0%, rgba(107,165,228,.20), transparent 34%),
    linear-gradient(135deg, #eef4fa 0%, #e3ebf4 100%);
}
.gsp-vs-top {
  flex: none; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px 13px;
  background: #436d9d; color: #fff; box-shadow: 0 3px 14px rgba(35,63,94,.22); z-index: 2;
}
.gsp-vs-back {
  appearance: none; border: 1px solid rgba(255,255,255,.20); background: rgba(255,255,255,.08);
  color: #fff; min-height: 32px; padding: 0 10px; border-radius: 8px;
  display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 11.5px; font-weight: 650;
}
.gsp-vs-back:hover:not(:disabled) { background: rgba(255,255,255,.16); }
.gsp-vs-back:disabled { opacity: .45; }
.gsp-vs-heading { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.gsp-vs-heading strong { font-size: 13.5px; font-weight: 700; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gsp-vs-heading span { font-size: 10.5px; opacity: .72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gsp-vs-top-actions { flex: none; display: flex; align-items: center; gap: 7px; }
.gsp-vs-frame-chip {
  border-radius: 999px; background: rgba(255,255,255,.13); color: rgba(255,255,255,.84);
  padding: 4px 9px; font-size: 10px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.gsp-vs-icon {
  appearance: none; border: 1px solid rgba(255,255,255,.18); background: transparent; color: #fff;
  width: 31px; height: 31px; border-radius: 8px; display: grid; place-items: center; cursor: pointer;
}
.gsp-vs-icon:hover, .gsp-vs-icon.is-on { background: rgba(255,255,255,.17); }
.gsp-vs-export {
  background: #fff; color: #365d87; border-color: transparent; min-height: 31px;
  box-shadow: 0 4px 12px rgba(24,48,75,.18);
}
.gsp-vs-export:hover:not(:disabled) { background: #f3f8fd; color: #274a70; }
.gsp-vs-body { flex: 1 1 auto; min-height: 0; display: flex; overflow: hidden; }
.gsp-vs-preview {
  flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 9px;
  padding: 13px 14px 10px;
}
.gsp-vs-canvas-wrap {
  position: relative; flex: 1 1 auto; min-height: 120px; display: flex; align-items: center; justify-content: center;
  overflow: hidden; border-radius: 10px;
}
.gsp-vs-canvas {
  display: block; width: 100%; height: 100%; object-fit: contain;
  border-radius: 8px; background: transparent;
  filter: drop-shadow(0 16px 32px rgba(31,58,88,.20));
}
.gsp-vs-overlay {
  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 9px; padding: 18px; text-align: center; color: #fff; font-size: 11.5px; line-height: 1.45;
  background: rgba(24,44,66,.58); backdrop-filter: blur(2px); border-radius: 10px;
}
.gsp-vs-overlay.is-error { background: rgba(84,30,36,.68); }
.gsp-vs-overlay.is-error strong { font-size: 13px; }
.gsp-vs-overlay.is-exporting {
  align-items: stretch; justify-content: flex-end; text-align: left;
  background: linear-gradient(to top, rgba(18,38,58,.88), rgba(18,38,58,.12) 72%);
  backdrop-filter: none;
}
.gsp-vs-export-progress-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 11.5px; }
.gsp-vs-export-progress-head strong { font-variant-numeric: tabular-nums; }
.gsp-vs-export-progress-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 10.5px; opacity: .9; }
.gsp-vs-export-progress-actions .gsp-btn { color: #fff; border-color: rgba(255,255,255,.4); background: rgba(255,255,255,.12); }
.gsp-vs-transport {
  flex: none; min-height: 43px; display: flex; align-items: center; gap: 9px;
  padding: 6px 9px; background: rgba(255,255,255,.92); border: 1px solid rgba(54,93,135,.14);
  border-radius: 10px; box-shadow: 0 4px 16px rgba(32,62,94,.08);
}
.gsp-studio .gsp-vs-play {
  appearance: none; border: 0; width: 31px; height: 31px; border-radius: 50%; flex: none; color: #fff;
  display: grid; place-items: center; background: #436d9d; color: #fff; cursor: pointer;
  box-shadow: 0 4px 10px rgba(67,109,157,.26);
}
.gsp-studio .gsp-vs-play:hover:not(:disabled) { background: #5588c7; color: #fff; }
.gsp-studio .gsp-vs-play:disabled { opacity: .4; cursor: default; }
.gsp-vs-time { flex: none; font-size: 10.5px; color: #53677c; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gsp-vs-range { flex: 1 1 auto; min-width: 0; accent-color: #436d9d; }
.gsp-vs-preview-chip {
  flex: none; border-radius: 999px; background: rgba(67,109,157,.10); color: #4d6884;
  padding: 3px 7px; font-size: 9.5px; font-weight: 650; white-space: nowrap;
}
.gsp-vs-error {
  flex: none; padding: 7px 9px; border-radius: 8px; font-size: 10.5px; line-height: 1.45;
  color: #a8303a; background: rgba(168,48,58,.09); border: 1px solid rgba(168,48,58,.22);
}
.gsp-vs-result {
  flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
  font-size: 10.5px; color: #53677c;
}
.gsp-vs-result a { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.gsp-vs-side {
  flex: 0 0 326px; width: 326px; min-width: 0; min-height: 0; display: flex; flex-direction: column;
  background: rgba(250,252,255,.96); border-left: 1px solid rgba(54,93,135,.15);
}
.gsp-vs-side-head {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: rgba(67,109,157,.07); border-bottom: 1px solid rgba(67,109,157,.16);
}
.gsp-vs-side-head h3 { margin: 0; flex: 1; font-size: 12.5px; font-weight: 700; color: #365d87; }
/* A fieldset refuses to shrink below its min-content width by default, which
   would push the whole panel past the viewport as soon as one row cannot wrap. */
.gsp-vs-fieldset { flex: 1 1 auto; min-width: 0; min-height: 0; border: 0; margin: 0; padding: 0; display: block; overflow: hidden; }
.gsp-vs-fieldset:disabled { opacity: .62; }
.gsp-vs-side-body { height: 100%; overflow-y: auto; padding: 3px 12px 16px; scrollbar-width: thin; }
.gsp-vs-side .gsp-group { padding: 9px 0 10px; }
.gsp-vs-side .gsp-field { grid-template-columns: 75px minmax(0, 1fr); gap: 7px; margin: 7px 0; }
.gsp-vs-side .gsp-field > label { font-size: 10.5px; }
.gsp-vs-side .gsp-check { font-size: 11px; }
.gsp-vs-check { display: flex; margin: 8px 0; }
.gsp-vs-ratio-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.gsp-vs-ratio {
  appearance: none; border: 1px solid rgba(54,93,135,.20); background: #fff; color: #53677c;
  min-height: 40px; border-radius: 7px; padding: 4px 2px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font: inherit; font-size: 9.5px; font-weight: 650;
}
.gsp-vs-ratio:hover { border-color: rgba(67,109,157,.55); color: #365d87; }
.gsp-vs-ratio.is-on { border-color: #436d9d; background: rgba(67,109,157,.10); color: #365d87; }
.gsp-vs-ratio-shape { display: block; width: 22px; height: 12.5px; border: 1.4px solid currentColor; border-radius: 2px; }
.gsp-vs-ratio-shape.is-4-3 { width: 20px; height: 15px; }
.gsp-vs-ratio-shape.is-1-1 { width: 17px; height: 17px; }
.gsp-vs-ratio-shape.is-3-4 { width: 13.5px; height: 18px; }
.gsp-vs-ratio-shape.is-9-16 { width: 11px; height: 19.5px; }
.gsp-vs-size-readout { display: flex; align-items: center; gap: 7px; margin-top: 8px; flex-wrap: wrap; }
.gsp-vs-source { display: flex; align-items: center; gap: 6px; margin-top: 7px; min-width: 0; }
.gsp-vs-source .gsp-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; display: block; }
.gsp-vs-side-foot { flex: none; padding: 7px 12px; border-top: 1px solid rgba(67,109,157,.14); font-size: 9.5px; color: #6f7f90; text-align: center; }
.gsp-vs-audio { position: absolute; left: -9999px; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.gsp-vs-mute {
  appearance: none; border: 0; background: transparent; color: #53677c;
  width: 27px; height: 27px; border-radius: 7px; flex: none; display: grid; place-items: center; cursor: pointer;
}
.gsp-vs-mute:hover:not(:disabled) { background: #edf3f9; color: #365d87; }
.gsp-vs-mute.is-muted { color: #a8303a; }
.gsp-vs-mute:disabled { opacity: .4; cursor: default; }
.gsp-vs-mount { position: absolute; left: -20000px; top: 0; width: 1760px; min-height: 100px; opacity: 0; pointer-events: none; }
.gsp-vs-modal { width: min(100%, 430px); max-height: calc(100vh - 36px); overflow-y: auto; }
.gsp-vs-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
.gsp-vs-modal-head h3 { margin: 0; }
.gsp-vs-modal-section { margin-top: 14px; }
.gsp-vs-modal-label { display: block; margin-bottom: 6px; font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
.gsp-vs-seg { display: flex; width: 100%; }
.gsp-vs-seg button { flex: 1 1 0; }
.gsp-vs-resolution-readout { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 7px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.gsp-vs-resolution-readout strong { color: var(--dsw-alias-label-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
.gsp-vs-custom-size { display: flex; align-items: flex-end; gap: 6px; margin-top: 8px; }
.gsp-vs-custom-size label { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.gsp-vs-custom-size .gsp-input { width: 100%; max-width: none; }
.gsp-vs-times { padding-bottom: 7px; color: var(--dsw-alias-label-secondary); }
.gsp-hint.is-warning { color: var(--dsw-alias-state-error-primary); }
.gsp-vs-audio-check { display: flex; margin-top: 14px; font-size: 11.5px; }
.gsp-vs-modal-error { margin-top: 8px; padding: 7px 9px; border-radius: 7px; font-size: 10.5px; color: var(--dsw-alias-state-error-primary); background: rgba(168,48,58,.08); }
.gsp-root.is-studio .gsp-toast { bottom: 16px; }
/* The studio is a light surface even when the host uses a dark theme. */
.gsp-studio { color: #243447; }
.gsp-studio .gsp-field > label,
.gsp-studio .gsp-hint,
.gsp-studio .gsp-check,
.gsp-studio .gsp-group h4,
.gsp-studio .gsp-value { color: #5e6d7e; }
.gsp-studio .gsp-select,
.gsp-studio .gsp-input,
.gsp-studio .gsp-color {
  background: #fff; color: #243447; border-color: rgba(54,93,135,.24);
}
.gsp-studio .gsp-select option { background: #fff; color: #243447; }
.gsp-studio .gsp-btn:not(.is-primary) { background: #fff; color: #365d87; border-color: rgba(54,93,135,.22); }
.gsp-studio .gsp-btn:not(.is-primary):hover:not(:disabled) { background: #f2f7fc; }
.gsp-studio .gsp-btn.is-ghost { background: transparent; border-color: transparent; color: #5e6d7e; }
.gsp-studio .gsp-btn.is-ghost:hover:not(:disabled) { background: #edf3f9; color: #243447; }
.gsp-studio .gsp-chip { background: #edf3f9; color: #53677c; }
.gsp-studio .gsp-chip.is-accent { background: rgba(67,109,157,.12); color: #365d87; }
.gsp-vs-modal { background: #fff; color: #243447; border-color: rgba(54,93,135,.22); }
.gsp-vs-modal h3, .gsp-vs-modal p { color: #243447; }
.gsp-vs-modal p.gsp-hint { color: #5e6d7e; }
.gsp-vs-modal .gsp-hint { color: #5e6d7e; }
.gsp-vs-modal .gsp-check { color: #5e6d7e; }
.gsp-vs-seg { background: #edf3f9; }
.gsp-vs-seg button { color: #5e6d7e; }
.gsp-vs-seg button.is-on { background: #fff; color: #243447; }
.gsp-vs-modal .gsp-btn:not(.is-primary) { background: #fff; color: #365d87; border-color: rgba(54,93,135,.22); }
.gsp-studio .gsp-side-close { color: #5e6d7e; }
.gsp-studio .gsp-side-close:hover { background: #edf3f9; color: #365d87; }
.gsp-studio .gsp-vs-modal-label,
.gsp-studio .gsp-vs-resolution-readout,
.gsp-studio .gsp-vs-custom-size label,
.gsp-studio .gsp-vs-times { color: #5e6d7e; }
.gsp-studio .gsp-vs-resolution-readout strong { color: #243447; }


@container (max-width: 860px) {
  .gsp-vs-body { flex-direction: column; }
  .gsp-vs-preview { flex: 1 1 auto; min-height: 46%; padding: 9px 10px 7px; }
  .gsp-vs-side { flex: 0 1 44%; width: 100%; max-height: 46%; border-left: 0; border-top: 1px solid rgba(54,93,135,.15); }
  .gsp-vs-side-body { padding-bottom: 12px; }
}
@container (max-width: 560px) {
  .gsp-vs-top { gap: 6px; padding-inline: 8px; }
  .gsp-vs-back { padding-inline: 7px; }
  .gsp-vs-back span { display: none; }
  .gsp-vs-heading span { display: none; }
  .gsp-vs-frame-chip { display: none; }
  .gsp-vs-preview-chip { display: none; }
  .gsp-vs-export { padding-inline: 8px; }
  .gsp-vs-side .gsp-field { grid-template-columns: 68px minmax(0, 1fr); }
  .gsp-vs-ratio-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 820px) {
  .gsp-vs-body { flex-direction: column; }
  .gsp-vs-preview { min-height: 46%; }
  .gsp-vs-side { width: 100%; max-height: 46%; border-left: 0; border-top: 1px solid rgba(54,93,135,.15); }
}
@media (max-width: 380px) {
  .gsp-vs-heading span, .gsp-vs-frame-chip, .gsp-vs-preview-chip { display: none; }
}
@media (max-width: 380px) {
  .gsp-header { padding-inline: 9px; }
  .gsp-transport { padding-inline: 9px; }
  .gsp-actionbar { padding-inline: 9px; }
  .gsp-field { grid-template-columns: 76px minmax(0, 1fr); }
}
`;
