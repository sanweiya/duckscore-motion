import type * as React from 'react';

/**
 * The host module table is only available after the bundle factory runs.
 * Components read this live binding so they all use the same React instance.
 */
export let ReactRuntime: typeof React = null as unknown as typeof React;

export function bindReactRuntime(runtime: typeof React): void {
  ReactRuntime = runtime;
}
