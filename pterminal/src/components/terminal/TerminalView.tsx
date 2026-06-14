import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';
import { useAppStore } from '@/stores/appStore';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
}

/**
 * Mounts an xterm.js instance for the given terminal id, wires keyboard input
 * to the PTY writer, and keeps the PTY size in sync on resize.
 *
 * The xterm instance lives in the registry (one per terminal id) and is reused
 * across mounts. `onData` is therefore registered at most once per instance
 * via a guard so re-mounts never produce duplicate keystrokes.
 */
export function TerminalView({ terminalId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read the current terminal font so newly-created xterm instances pick it
  // up at creation time (avoids a flash of the default font). Per-terminal
  // fontSize override takes precedence over the global default (N4).
  const terminals = useAppStore((s) => s.terminals);
  const terminal = terminals.find((t) => t.id === terminalId);
  const fontFamily = useAppStore((s) => s.fontFamily);
  const globalFontSize = useAppStore((s) => s.fontSize);
  const fontSize = terminal?.fontSize ?? globalFontSize;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Ensure an xterm instance exists for this id (creates + registers it).
    const term = terminalRegistry.ensure(terminalId, { fontFamily, fontSize });

    // Bind the PTY writer exactly once per xterm instance. The registry tracks
    // whether input forwarding has been wired so re-mounts are no-ops.
    terminalRegistry.bindInput(terminalId, (data) => {
      void terminalService.write(terminalId, data);
    });

    terminalRegistry.attach(terminalId, container);
    term.focus();

    // Report initial size so the shell knows the window dimensions.
    const initial = terminalRegistry.fit(terminalId);
    if (initial) {
      void terminalService.resize(terminalId, initial);
    }

    // Resize handling: observer + window listener (debounced via rAF).
    let raf = 0;
    const scheduleResize = () => {
      // Ignore size changes to 0 (the container was hidden via display:none
      // because another terminal became active). Fitting a 0×0 box would
      // shrink the terminal to its 2×1 minimum and wipe its scrollback.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const size = terminalRegistry.fit(terminalId);
        if (size) void terminalService.resize(terminalId, size);
      });
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);
    window.addEventListener('resize', scheduleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleResize);
      if (raf) cancelAnimationFrame(raf);
      // NOTE: we intentionally do NOT dispose the xterm instance or unbind
      // input here — the instance persists across terminal switches so its
      // scrollback is preserved.
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        padding: '4px 8px',
        backgroundColor: 'var(--color-terminal-bg)',
      }}
    />
  );
}

// Re-export for callers that need the xterm type directly.
export type { Terminal };
