import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { TerminalView } from '@/components/terminal/TerminalView';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';

/**
 * Central terminal column. Renders ONE persistent TerminalView per terminal id
 * (kept mounted, toggled via CSS display) so switching terminals never loses
 * scrollback — xterm.js instances stay attached to their DOM containers for
 * their entire lifetime.
 */
export function CenterPanel() {
  const terminals = useAppStore((s) => s.terminals);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);

  return (
    <div className="panel h-full">
      <div className="flex-1 min-h-0 relative">
        {terminals.length === 0 ? (
          <div
            className="flex h-full items-center justify-center"
            style={{ backgroundColor: 'var(--color-terminal-bg)' }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                color: 'var(--color-text-muted)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              <img
                src="/logo.png"
                alt="PTerminal"
                style={{ width: 112, height: 112, opacity: 0.9, borderRadius: 24 }}
              />
              <div>
                <p style={{ marginBottom: 8 }}>No active terminal</p>
                <p style={{ fontSize: 11 }}>
                  Create or select a terminal from the left panel
                </p>
              </div>
            </div>
          </div>
        ) : (
          terminals.map((t) => (
            <TerminalHost
              key={t.id}
              terminalId={t.id}
              active={t.id === activeTerminalId}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Wraps a TerminalView. The DOM (and thus the xterm instance) stays mounted
 * for the terminal's lifetime; we only toggle visibility so the shell output
 * buffer is preserved across switches.
 */
function TerminalHost({
  terminalId,
  active,
}: {
  terminalId: string;
  active: boolean;
}) {
  // When this host becomes active, refit the terminal to the now-visible
  // container and notify the PTY of the new size.
  useEffect(() => {
    if (!active) return;
    // Defer fit until after the container is actually displayed.
    const raf = requestAnimationFrame(() => {
      const size = terminalRegistry.fit(terminalId);
      if (size) void terminalService.resize(terminalId, size);
      terminalRegistry.focus(terminalId);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, terminalId]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: active ? 'block' : 'none',
      }}
    >
      <TerminalView terminalId={terminalId} />
    </div>
  );
}
