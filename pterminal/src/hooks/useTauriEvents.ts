import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';
import { useAppStore } from '@/stores/appStore';
import type {
  TerminalDataPayload,
  TerminalExitPayload,
} from '@/types';

/**
 * Subscribe to the global Tauri events emitted by the Rust backend:
 *  - `terminal-data`: PTY output, routed to the right xterm instance.
 *  - `terminal-exit`: shell exited → remove the terminal (sidebar/store/DB).
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
      // Shell process exited (user typed `exit`, etc.) — close the terminal.
      useAppStore.getState().handleTerminalExit(event.payload.id);
    }).then((un) => unlisteners.push(un));

    let cancelled = false;
    void getCurrentWebview().onDragDropEvent(async (event) => {
      const p = event.payload;
      if (p.type !== 'drop' || p.paths.length === 0) return;
      const activeTerminalId = useAppStore.getState().activeTerminalId;
      if (!activeTerminalId) return;

      const scale = await getCurrentWindow().scaleFactor();
      const px = p.position.x / scale;
      const py = p.position.y / scale;
      if (!terminalRegistry.containsPoint(activeTerminalId, px, py)) return;

      const text = p.paths.map(quoteForShell).join(' ');
      void terminalService.write(activeTerminalId, text);
      terminalRegistry.focus(activeTerminalId);
    }).then((un) => {
      if (cancelled) un();
      else unlisteners.push(un);
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, []);
}

const SHELL_SPECIAL = /[\s()&$`\\"'*?[\]<>;!#~{}=|]/;

function quoteForShell(path: string): string {
  if (!SHELL_SPECIAL.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
