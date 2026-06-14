import { useEffect, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { Toaster } from '@/components/Toaster';
import { useTauriEvents } from '@/hooks/useTauriEvents';
import { useAIStream } from '@/hooks/useAIStream';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAppStore } from '@/stores/appStore';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';

function App() {
  // Wire up the global Tauri event listeners (terminal-data / exit).
  useTauriEvents();
  // Wire up the AI streaming event listeners (ai-delta / ai-done).
  useAIStream();
  // Wire up global keyboard shortcuts.
  useKeyboardShortcuts();

  const loadTerminals = useAppStore((s) => s.loadTerminals);
  const loadSshShortcuts = useAppStore((s) => s.loadSshShortcuts);
  const loadAppearance = useAppStore((s) => s.loadAppearance);
  const activeView = useAppStore((s) => s.activeView);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const prevView = useRef(activeView);

  useEffect(() => {
    void loadTerminals();
    void loadSshShortcuts();
    void loadAppearance();
  }, [loadTerminals, loadSshShortcuts, loadAppearance]);

  // When returning from settings to the terminal view, every xterm canvas was
  // frozen while its ancestor had display:none. fit() alone won't repaint it
  // (logical size is often unchanged), so we explicitly refresh each terminal
  // once layout has settled. Deferred via rAF so display has flipped first.
  useEffect(() => {
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
      {/* Both views stay mounted (toggled via CSS) so switching to settings
          and back never unmounts AppLayout — which would otherwise detach and
          re-attach every xterm.js instance, losing terminal scrollback. */}
      <div style={{ display: activeView === 'settings' ? 'none' : 'contents' }}>
        <AppLayout />
      </div>
      <div style={{ display: activeView === 'settings' ? 'contents' : 'none' }}>
        <SettingsPage onBack={() => setActiveView('terminal')} />
      </div>
      <Toaster />
    </>
  );
}

export default App;
