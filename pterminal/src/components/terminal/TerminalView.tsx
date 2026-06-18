import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';
import { useAppStore } from '@/stores/appStore';
import { useTerminalAutocomplete } from '@/hooks/useTerminalAutocomplete';
import { TerminalAutocomplete } from './TerminalAutocomplete';
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
 *
 * AI inline autocomplete is layered on top:
 * - The PTY writer callback ALSO feeds keystrokes to the autocomplete hook so
 *   it can model the current input line. The hook does NOT write to the PTY
 *   itself, so each keystroke is written exactly once.
 * - A capture-phase keydown listener intercepts Tab / ArrowRight (accept) and
 *   Escape (dismiss) when a suggestion is visible, preventing the keystroke
 *   from reaching xterm/the shell.
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

  // AI autocomplete hook. `handleInput` is read-only (no PTY write); `accept`
  // writes the selected suggestion suffix to the PTY.
  const {
    state: autocompleteState,
    handleInput,
    accept,
    dismiss,
    selectNext,
    selectPrev,
  } = useTerminalAutocomplete(terminalId);

  // Keep the latest callbacks/visible in refs so the capture-phase keydown
  // listener (registered once) always sees fresh values.
  const handleInputRef = useRef(handleInput);
  const acceptRef = useRef(accept);
  const dismissRef = useRef(dismiss);
  const selectNextRef = useRef(selectNext);
  const selectPrevRef = useRef(selectPrev);
  const visibleRef = useRef(autocompleteState.visible);
  handleInputRef.current = handleInput;
  acceptRef.current = accept;
  dismissRef.current = dismiss;
  selectNextRef.current = selectNext;
  selectPrevRef.current = selectPrev;
  visibleRef.current = autocompleteState.visible;

  useEffect(() => {
    terminalRegistry.applyFont(terminalId, fontFamily, fontSize);
  }, [terminalId, fontFamily, fontSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Ensure an xterm instance exists for this id (creates + registers it).
    const term = terminalRegistry.ensure(terminalId, { fontFamily, fontSize });

    // Bind the PTY writer exactly once per xterm instance. The registry tracks
    // whether input forwarding has been wired so re-mounts are no-ops.
    // This is the ONLY path that writes keystrokes to the shell.
    terminalRegistry.bindInput(terminalId, (data) => {
      void terminalService.write(terminalId, data);
    });

    // Subscribe the autocomplete hook as a READ-ONLY observer of the same
    // keystroke stream. The hook does NOT write to the PTY — that would
    // duplicate every keystroke. onInput returns an unsubscribe for cleanup.
    const unsubscribeInput = terminalRegistry.onInput(terminalId, (data) => {
      handleInputRef.current(data);
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

    // Intercept navigation keys at the capture phase so we can control the
    // autocomplete suggestion/menu before xterm/the shell sees the key.
    // Only active while a suggestion is visible.
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (terminalRegistry.isSensitiveInputPrompt(terminalId)) return;
      if (!visibleRef.current) return;
      const keys = ['Tab', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'];
      if (!keys.includes(e.key)) return;
      // Ignore if the user is holding modifiers (allow Cmd+Tab, Ctrl+Tab, etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      switch (e.key) {
        case 'Escape':
          dismissRef.current();
          break;
        case 'ArrowUp':
          selectPrevRef.current();
          break;
        case 'ArrowDown':
          selectNextRef.current();
          break;
        default: // Tab, ArrowRight
          acceptRef.current();
      }
    };
    container.addEventListener('keydown', onKeyDownCapture, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleResize);
      container.removeEventListener('keydown', onKeyDownCapture, true);
      unsubscribeInput();
      if (raf) cancelAnimationFrame(raf);
      // NOTE: we intentionally do NOT dispose the xterm instance or unbind
      // input here — the instance persists across terminal switches so its
      // scrollback is preserved.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative"
      style={{
        padding: '4px 8px',
        backgroundColor: 'var(--color-terminal-bg)',
      }}
    >
      <TerminalAutocomplete
        terminalId={terminalId}
        suggestions={autocompleteState.suggestions}
        selectedIndex={autocompleteState.selectedIndex}
        visible={autocompleteState.visible}
        loading={autocompleteState.loading}
        currentInput={autocompleteState.currentInput}
        cursorX={autocompleteState.cursorX}
        cursorY={autocompleteState.cursorY}
      />
    </div>
  );
}

// Re-export for callers that need the xterm type directly.
export type { Terminal };
