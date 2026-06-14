import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { terminalRegistry } from '@/services/terminalRegistry';
import type {
  TerminalDataPayload,
  TerminalExitPayload,
} from '@/types';

/**
 * Subscribe to the global Tauri events emitted by the Rust backend:
 *  - `terminal-data`: PTY output, routed to the right xterm instance.
 *  - `terminal-exit`: shell exited → log only.
 *
 * Mounted once at the app root.
 */
export function useTauriEvents(): void {
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    listen<TerminalDataPayload>('terminal-data', (event) => {
      terminalRegistry.write(event.payload.id, event.payload.data);
    }).then((un) => unlisteners.push(un));

    listen<TerminalExitPayload>('terminal-exit', (event) => {
      // Shell process exited; terminal stays in the list for review.
      console.log('terminal-exit', event.payload.id);
    }).then((un) => unlisteners.push(un));

    return () => {
      unlisteners.forEach((un) => un());
    };
  }, []);
}
