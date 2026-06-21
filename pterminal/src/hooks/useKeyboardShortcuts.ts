import { useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore, DEFAULT_FONT_SIZE } from '@/stores/appStore';
import {
  loadShortcuts,
  matchesShortcut,
  type ShortcutDef,
} from '@/services/shortcutService';

/**
 * Global keyboard shortcuts. Meta/Cmd-based combos are safe to intercept
 * because the PTY only receives printable keystrokes (handled by xterm's
 * onData, which does not forward Cmd-modified keys to the shell).
 *
 * All shortcuts are configurable in Settings > Shortcuts and loaded from
 * the shortcut service. Default bindings (New Terminal = ⌘N, etc.) match
 * the hints shown elsewhere in the UI.
 */
export function useKeyboardShortcuts(): void {
  // Keep the shortcuts in a ref so the keydown handler always sees the
  // latest bindings without re-binding the listener on every change.
  const shortcutsRef = useRef<ShortcutDef[]>(loadShortcuts());

  useEffect(() => {
    // Reload when another tab/window changes the stored config, and expose
    // an app-internal event so the settings page can trigger a refresh in
    // the same document after saving.
    const reload = () => {
      shortcutsRef.current = loadShortcuts();
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'keyboard_shortcuts') reload();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('shortcuts-changed', reload);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('shortcuts-changed', reload);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      const store = useAppStore.getState();
      const shortcuts = shortcutsRef.current;

      // Walk the configured bindings; the first match wins. This is the
      // single source of truth — there is no hardcoded fallback, so
      // customizing a shortcut in Settings actually changes its behavior.
      for (const shortcut of shortcuts) {
        if (matchesShortcut(e, shortcut.binding)) {
          e.preventDefault();
          executeShortcut(shortcut.id, store);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

/** Execute a shortcut by its ID against the current store. */
function executeShortcut(
  id: string,
  store: ReturnType<typeof useAppStore.getState>
): void {
  switch (id) {
    case 'newTerminal':
      void store.createTerminal();
      break;
    case 'closeTerminal':
      if (store.activeTerminalId && store.terminals.length > 0) {
        void store.deleteTerminal(store.activeTerminalId);
      } else {
        void getCurrentWindow().hide();
      }
      break;
    case 'nextTerminal': {
      const terminals = store.terminals;
      const idx = terminals.findIndex((t) => t.id === store.activeTerminalId);
      if (idx !== -1 && terminals.length > 1) {
        const next = (idx + 1) % terminals.length;
        store.setActiveTerminal(terminals[next].id);
      }
      break;
    }
    case 'prevTerminal': {
      const terminals = store.terminals;
      const idx = terminals.findIndex((t) => t.id === store.activeTerminalId);
      if (idx !== -1 && terminals.length > 1) {
        const prev = (idx - 1 + terminals.length) % terminals.length;
        store.setActiveTerminal(terminals[prev].id);
      }
      break;
    }
    case 'focusTerminal1':
      if (store.terminals.length > 0) store.setActiveTerminal(store.terminals[0].id);
      break;
    case 'focusTerminal2':
      if (store.terminals.length > 1) store.setActiveTerminal(store.terminals[1].id);
      break;
    case 'focusTerminal3':
      if (store.terminals.length > 2) store.setActiveTerminal(store.terminals[2].id);
      break;
    case 'zoomIn':
      void store.adjustTerminalFontSize(1);
      break;
    case 'zoomOut':
      void store.adjustTerminalFontSize(-1);
      break;
    case 'zoomReset': {
      const at = store.terminals.find((t) => t.id === store.activeTerminalId);
      const current = at?.fontSize ?? store.fontSize;
      void store.adjustTerminalFontSize(DEFAULT_FONT_SIZE - current);
      break;
    }
    case 'toggleSearch':
      if (store.activeTerminalId) {
        store.setSearchBarVisible(!store.isSearchBarVisible);
      }
      break;
    case 'toggleLeftPanel':
      store.toggleLeftPanel();
      break;
    case 'toggleRightPanel':
      store.toggleRightPanel();
      break;
    case 'toggleTheme':
      store.toggleDarkMode();
      break;
    default:
      console.warn('Unknown shortcut:', id);
  }
}
