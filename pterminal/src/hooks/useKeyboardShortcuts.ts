import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore, DEFAULT_FONT_SIZE } from '@/stores/appStore';

/**
 * Global keyboard shortcuts. Meta/Cmd-based combos are safe to intercept
 * because the PTY only receives printable keystrokes (handled by xterm's
 * onData, which does not forward Cmd-modified keys to the shell).
 *
 *  - Cmd+T / Cmd+N   New terminal
 *  - Cmd+W           Close active terminal (hides window if none remain)
 *  - Cmd+1..3        Activate the 1st–3rd terminal in the sidebar
 *  - Cmd+F           Toggle the terminal find bar
 *  - Cmd+Shift+]     Next terminal
 *  - Cmd+Shift+[     Previous terminal
 *  - Cmd+Shift+P     Toggle right panel
 *  - Cmd+Shift+L     Toggle dark / light theme
 *  - Cmd+= / Cmd++   Zoom terminal in
 *  - Cmd+-           Zoom terminal out
 *  - Cmd+0           Reset terminal zoom to 100%
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      const store = useAppStore.getState();
      const key = e.key;

      // Cmd+T or Cmd+N — new terminal
      if ((key === 't' || key === 'n') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void store.createTerminal();
        return;
      }

      // Cmd+W — close active terminal; if no terminals remain, hide the window
      // to the Dock (same as the traffic-light close button, which never quits).
      if (key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (store.activeTerminalId && store.terminals.length > 0) {
          void store.deleteTerminal(store.activeTerminalId);
        } else {
          void getCurrentWindow().hide();
        }
        return;
      }

      // Cmd+1..3 — activate the Nth terminal in the sidebar list.
      if (!e.shiftKey && !e.altKey && (key === '1' || key === '2' || key === '3')) {
        const idx = Number(key) - 1;
        const terminals = store.terminals;
        if (idx < terminals.length) {
          e.preventDefault();
          store.setActiveTerminal(terminals[idx].id);
        }
        return;
      }

      // Cmd+F — toggle the find bar for the active terminal (prevents the
      // webview's native in-page find from opening).
      if (key === 'f' && !e.shiftKey && !e.altKey) {
        if (store.activeTerminalId) {
          e.preventDefault();
          store.setSearchBarVisible(!store.isSearchBarVisible);
        }
        return;
      }

      // Cmd+= / Cmd++ — zoom terminal in
      // Cmd+- — zoom terminal out
      // Cmd+0 — reset terminal zoom to 100%
      if (!e.shiftKey && !e.altKey && (key === '=' || key === '+' || key === '-' || key === '_')) {
        e.preventDefault();
        const delta = key === '-' || key === '_' ? -1 : 1;
        void store.adjustTerminalFontSize(delta);
        return;
      }
      if (!e.shiftKey && !e.altKey && key === '0') {
        e.preventDefault();
        // Reset the ACTIVE terminal's size to the default (13px = 100%).
        const at = store.terminals.find((t) => t.id === store.activeTerminalId);
        const current = at?.fontSize ?? store.fontSize;
        void store.adjustTerminalFontSize(DEFAULT_FONT_SIZE - current);
        return;
      }

      // Cmd+Shift+] / Cmd+Shift+[ — cycle terminals
      if (e.shiftKey && (key === ']' || key === '[')) {
        e.preventDefault();
        const terminals = store.terminals;
        const idx = terminals.findIndex((t) => t.id === store.activeTerminalId);
        if (idx === -1 || terminals.length <= 1) return;
        const next = key === ']' ? (idx + 1) % terminals.length : (idx - 1 + terminals.length) % terminals.length;
        store.setActiveTerminal(terminals[next].id);
        return;
      }

      // Cmd+Shift+P — toggle right panel
      if (e.shiftKey && key.toLowerCase() === 'p') {
        e.preventDefault();
        store.toggleRightPanel();
        return;
      }

      // Cmd+Shift+L — toggle theme
      if (e.shiftKey && key.toLowerCase() === 'l') {
        e.preventDefault();
        store.toggleDarkMode();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
