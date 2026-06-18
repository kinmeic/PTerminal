import { lazy, Suspense, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppLayout } from '@/components/layout/AppLayout';
import { Toaster } from '@/components/Toaster';
import { useTauriEvents } from '@/hooks/useTauriEvents';
import { useAIStream } from '@/hooks/useAIStream';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/stores/appStore';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';
import { dismissTerminalAutocomplete } from '@/services/autocompleteEvents';

const SettingsPage = lazy(() =>
  import('@/components/settings/SettingsPage').then((mod) => ({
    default: mod.SettingsPage,
  }))
);

function App() {
  // Wire up the global Tauri event listeners (terminal-data / exit).
  useTauriEvents();
  // Wire up the AI streaming event listeners (ai-delta / ai-done).
  useAIStream();
  // Wire up global keyboard shortcuts.
  useKeyboardShortcuts();

  const loadTerminals = useAppStore((s) => s.loadTerminals);
  const loadSshShortcuts = useAppStore((s) => s.loadSshShortcuts);
  const loadCustomCompletions = useAppStore((s) => s.loadCustomCompletions);
  const loadAppearance = useAppStore((s) => s.loadAppearance);
  const loadUiState = useAppStore((s) => s.loadUiState);
  const setFullscreen = useAppStore((s) => s.setFullscreen);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const prevView = useRef(activeView);

  useEffect(() => {
    void loadTerminals();
    void loadSshShortcuts();
    void loadCustomCompletions();
    void loadAppearance();
    void loadUiState();
  }, [loadTerminals, loadSshShortcuts, loadCustomCompletions, loadAppearance, loadUiState]);

  // Track native fullscreen state (需求 2). Tauri 2 has no dedicated
  // fullscreen event, but `tauri://resize` (fired by `onResized`) is the
  // reliable signal for entering/exiting macOS fullscreen — re-query
  // `isFullscreen()` on each resize and mirror it into the store.
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    const win = getCurrentWindow();
    const sync = () => {
      win
        .isFullscreen()
        .then((f) => setFullscreen(f))
        .catch(() => {});
    };
    sync(); // sync initial state
    win.onResized(sync).then((un) => {
      unlistenFn = un;
    });
    return () => {
      unlistenFn?.();
    };
  }, [setFullscreen]);

  // When returning from settings to the terminal view, every xterm canvas was
  // frozen while its ancestor had display:none. fit() alone won't repaint it
  // (logical size is often unchanged), so we explicitly refresh each terminal
  // once layout has settled. Deferred via rAF so display has flipped first.
  useEffect(() => {
    if (activeView === 'settings') {
      dismissTerminalAutocomplete();
    }
    if (prevView.current === 'settings' && activeView === 'terminal') {
      const raf = requestAnimationFrame(() => {
        for (const id of terminalRegistry.ids()) {
          const size = terminalRegistry.fit(id);
          if (size) void terminalService.resize(id, size);
          terminalRegistry.refresh(id);
        }
      });
      return () => cancelAnimationFrame(raf);
    }
    prevView.current = activeView;
  }, [activeView]);

  return (
    <>
      {/* AppLayout stays mounted while settings is shown, so switching back never
          detaches xterm.js instances or loses terminal scrollback. */}
      <div style={{ display: activeView === 'settings' ? 'none' : 'contents' }}>
        <AppLayout />
      </div>
      {activeView === 'settings' && (
        <Suspense fallback={null}>
          <SettingsPage onBack={() => setActiveView('terminal')} />
        </Suspense>
      )}
      <Toaster />
    </>
  );
}

export default App;
