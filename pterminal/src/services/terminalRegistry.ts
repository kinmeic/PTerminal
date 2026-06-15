import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  /** Buffer of PTY data received while the terminal is detached/unmounted. */
  pending: string[];
  /** Output queued for the next animation frame while the terminal is mounted. */
  writeQueue: string;
  writeRaf: number;
  /** Whether the onData → PTY writer binding has already been attached. */
  inputBound: boolean;
}

/**
 * Registry that owns xterm.js instances keyed by terminal id. Tauri events
 * (terminal-data) route here to write PTY output to the right terminal even
 * when its React component is unmounted (output is buffered and flushed on
 * attach).
 */
class TerminalRegistry {
  private entries = new Map<string, TerminalEntry>();

  /** Create (or reuse) an xterm instance for the given id. */
  ensure(
    id: string,
    opts?: { fontFamily?: string; fontSize?: number; lineHeight?: number }
  ): Terminal {
    let entry = this.entries.get(id);
    if (entry) return entry.term;

    const term = new Terminal({
      cursorBlink: true,
      // false is correct here: a real PTY already converts \n → \r\n on output,
      // so enabling xterm's EOL conversion would double-convert and break
      // cursor positioning. (PLAN.md mentioned true; that was a design draft
      // error — the code is authoritative.)
      convertEol: false,
      fontFamily: opts?.fontFamily ?? "'SF Mono', 'Monaco', 'Consolas', monospace",
      fontSize: opts?.fontSize ?? 13,
      lineHeight: opts?.lineHeight ?? 1,
      scrollback: 10000,
      allowProposedApi: true,
      theme: readThemeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    entry = { term, fit, pending: [], writeQueue: '', writeRaf: 0, inputBound: false };
    this.entries.set(id, entry);
    return term;
  }

  /**
   * Wire the xterm `onData` (user keystrokes) to a writer callback exactly
   * once per instance. Repeated calls for the same id are no-ops, which keeps
   * re-mounts (e.g. React StrictMode) from duplicating input.
   */
  bindInput(id: string, writer: (data: string) => void): void {
    const entry = this.entries.get(id);
    if (!entry || entry.inputBound) return;
    entry.term.onData(writer);
    entry.inputBound = true;
  }

  /** Open the terminal into a DOM container and fit it; flush any buffered data. */
  attach(id: string, container: HTMLElement): FitAddon | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (!entry.term.element || entry.term.element.parentElement !== container) {
      entry.term.open(container);
    }
    // Flush buffered output captured while detached.
    if (entry.pending.length > 0) {
      entry.writeQueue += entry.pending.join('');
      entry.pending = [];
      this.flushWrite(entry);
    }
    return entry.fit;
  }

  /** Write PTY output, buffering if the terminal has not been opened yet. */
  write(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.term.element) {
      entry.writeQueue += data;
      if (!entry.writeRaf) {
        entry.writeRaf = requestAnimationFrame(() => {
          entry.writeRaf = 0;
          this.flushWrite(entry);
        });
      }
    } else {
      entry.pending.push(data);
    }
  }

  fit(id: string): { cols: number; rows: number } | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    // Skip fitting when the container is detached or hidden (display:none),
    // which reports 0×0. Letting FitAddon run on a 0-size box clamps the
    // terminal to 2×1, triggering renderService.clear() + a lossy buffer
    // reflow that wipes the visible scrollback. We re-fit on the next real
    // size change (when the terminal becomes visible again).
    const el = entry.term.element?.parentElement;
    if (el && (el.clientWidth === 0 || el.clientHeight === 0)) return null;
    try {
      entry.fit.fit();
      return { cols: entry.term.cols, rows: entry.term.rows };
    } catch {
      return null;
    }
  }

  /**
   * Read the last `maxLines` of terminal output as plain text, for passing to
   * the AI assistant as context. Wrapped lines (isWrapped) are joined back to
   * their parent line so logical lines aren't split. Purely blank trailing
   * lines are trimmed.
   */
  readTailLines(id: string, maxLines: number): string {
    const entry = this.entries.get(id);
    if (!entry || maxLines <= 0) return '';
    const buf = entry.term.buffer.active;
    const total = buf.length;
    if (total === 0) return '';
    const start = Math.max(0, total - maxLines);
    const parts: string[] = [];
    for (let i = start; i < total; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && parts.length > 0) {
        // Continuation of the previous logical line — append without newline.
        parts[parts.length - 1] += text;
      } else {
        parts.push(text);
      }
    }
    // Trim trailing empty lines.
    while (parts.length > 0 && parts[parts.length - 1].trim() === '') {
      parts.pop();
    }
    return parts.join('\n');
  }

  /** Clear terminal output and reset scrollback. */
  clear(id: string): void {
    this.entries.get(id)?.term.clear();
  }

  /**
   * Force a full redraw of the terminal viewport. Needed after the container
   * was hidden (ancestor display:none) and is shown again: xterm's render
   * layer freezes while hidden and `fit()` alone won't trigger a repaint when
   * the logical size is unchanged. Call this right after `fit()` on reveal.
   */
  refresh(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const term = entry.term;
    if (term.rows > 0) term.refresh(0, term.rows - 1);
  }

  /** Refresh every live terminal (e.g. after the whole view becomes visible). */
  refreshAll(): void {
    for (const entry of this.entries.values()) {
      const term = entry.term;
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    }
  }

  /** All registered terminal ids. */
  ids(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Focus the terminal input. */
  focus(id: string): void {
    this.entries.get(id)?.term.focus();
  }

  containsPoint(id: string, x: number, y: number): boolean {
    const entry = this.entries.get(id);
    const el = entry?.term.element?.parentElement;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /** Dispose the xterm instance and release resources. */
  dispose(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.writeRaf) cancelAnimationFrame(entry.writeRaf);
    entry.term.dispose();
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Re-apply the current CSS-variable-based theme to all live instances.
   *  Call after toggling dark/light mode. */
  rethemeAll(): void {
    const theme = readThemeFromCss();
    for (const entry of this.entries.values()) {
      entry.term.options.theme = theme;
    }
  }

  /** Apply a font family/size to all live terminals, then refit. Used by the
   *  appearance settings and the top-bar zoom controls. */
  applyFontAll(fontFamily: string, fontSize: number, lineHeight?: number): void {
    for (const entry of this.entries.values()) {
      entry.term.options.fontFamily = fontFamily;
      entry.term.options.fontSize = fontSize;
      if (lineHeight !== undefined) entry.term.options.lineHeight = lineHeight;
    }
    // Refit each visible terminal so rows/cols match the new glyph metrics.
    for (const id of this.entries.keys()) {
      this.fit(id);
    }
  }

  /** Apply font family/size to a single terminal, then refit it. Used when
   *  font size is per-terminal (zoom affects only the active terminal). */
  applyFont(id: string, fontFamily: string, fontSize: number, lineHeight?: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.term.options.fontFamily = fontFamily;
    entry.term.options.fontSize = fontSize;
    if (lineHeight !== undefined) entry.term.options.lineHeight = lineHeight;
    this.fit(id);
  }

  private flushWrite(entry: TerminalEntry): void {
    const chunk = entry.writeQueue;
    entry.writeQueue = '';
    if (!chunk) return;
    if (entry.term.element) entry.term.write(chunk);
    else entry.pending.push(chunk);
  }
}

export const terminalRegistry = new TerminalRegistry();

/** Read the active theme colors from CSS variables so the xterm instance
 *  matches the current dark/light theme and column backgrounds. */
function readThemeFromCss(): import('@xterm/xterm').ITheme {
  const css = (name: string) =>
    getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  return {
    background: css('--color-terminal-bg') || '#161616',
    foreground: css('--color-terminal-fg') || '#c9d1d9',
    cursor: css('--color-terminal-cursor') || '#58a6ff',
    selectionBackground: css('--color-terminal-selection') || '#264f78',
    black: css('--color-terminal-black') || '#484f58',
    red: css('--color-terminal-red') || '#ff7b72',
    green: css('--color-terminal-green') || '#3fb950',
    yellow: css('--color-terminal-yellow') || '#d29922',
    blue: css('--color-terminal-blue') || '#58a6ff',
    magenta: css('--color-terminal-magenta') || '#bc8cff',
    cyan: css('--color-terminal-cyan') || '#39c5cf',
    white: css('--color-terminal-white') || '#b1bac4',
  };
}
