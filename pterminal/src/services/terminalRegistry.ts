import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';

interface ImeFixState {
  textarea: HTMLTextAreaElement;
  inputHandler: (ev: Event) => void;
  onDataDisposable: IDisposable;
}

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  /** Search addon used by the Cmd+F find bar to highlight/jump between matches. */
  search: SearchAddon;
  /** Buffer of PTY data received while the terminal is detached/unmounted. */
  pending: string[];
  /** Output queued for the next animation frame while the terminal is mounted. */
  writeQueue: string;
  writeRaf: number;
  /** Whether the onData → PTY writer binding has already been attached. */
  inputBound: boolean;
  /** The PTY writer, set when bindInput is called. Used by the IME fix to
   *  forward recovered characters directly to the shell. */
  writer?: (data: string) => void;
  /** Read-only input subscribers (e.g. autocomplete) that observe keystrokes
   *  WITHOUT writing to the PTY. The PTY writer (bindInput) is the only path
   *  that forwards data to the shell; subscribers just get a copy. */
  inputListeners: Set<(data: string) => void>;
  /** Pending rAF while waiting for xterm's textarea to become available. */
  imeAttachRaf: number;
  /** Resources owned by the IME insertText recovery hook. */
  imeFix?: ImeFixState;
  /** Recent raw PTY output tail, used before xterm's render buffer catches up. */
  outputTail: string;
  /** True while the active prompt is asking for hidden/sensitive input. */
  sensitiveInputActive: boolean;
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
    // Search addon powers the Cmd+F find bar (highlight matches + jump prev/next).
    const search = new SearchAddon();
    term.loadAddon(search);

    entry = {
      term,
      fit,
      search,
      pending: [],
      writeQueue: '',
      writeRaf: 0,
      inputBound: false,
      inputListeners: new Set(),
      imeAttachRaf: 0,
      outputTail: '',
      sensitiveInputActive: false,
    };
    this.entries.set(id, entry);
    return term;
  }

  /**
   * Wire the xterm `onData` (user keystrokes) to a writer callback exactly
   * once per instance. Repeated calls for the same id are no-ops, which keeps
   * re-mounts (e.g. React StrictMode) from duplicating input.
   *
   * The writer is the ONLY path that forwards data to the PTY. Any read-only
   * observers registered via `onInput` receive a copy of the same data, but
   * must never write to the shell themselves — otherwise every keystroke ends
   * up in the PTY twice.
   */
  bindInput(id: string, writer: (data: string) => void): void {
    const entry = this.entries.get(id);
    if (!entry || entry.inputBound) return;
    entry.writer = writer;
    // Single fan-out: forward to the PTY writer AND every read-only subscriber.
    entry.term.onData((data) => {
      writer(data);
      for (const fn of entry.inputListeners) fn(data);
    });
    entry.inputBound = true;
    // IME 修复依赖 writer + onData，在绑定后挂载（textarea 也需要已 open）。
    this.fixImeInsertText(id);
  }

  /**
   * Subscribe to keystroke data for a terminal WITHOUT writing to the PTY.
   * Used by features like autocomplete that only need to observe the input
   * stream. Returns an unsubscribe function.
   */
  onInput(id: string, listener: (data: string) => void): () => void {
    const entry = this.entries.get(id);
    if (!entry) return () => {};
    entry.inputListeners.add(listener);
    return () => {
      entry.inputListeners.delete(listener);
    };
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
    this.updateSensitiveInputState(entry, data);
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

  /** Whether the active prompt appears to be requesting sensitive hidden input. */
  isSensitiveInputPrompt(id: string): boolean {
    const entry = this.entries.get(id);
    if (entry?.sensitiveInputActive) return true;

    const tail = this.readTailLines(id, 4);
    if (!tail) return false;
    const lastLine = tail.split('\n').filter((line) => line.trim().length > 0).pop() ?? '';
    return SENSITIVE_INPUT_PROMPT_RE.test(lastLine);
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
    this.disposeImeFix(entry);
    entry.term.dispose();
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Get the underlying xterm.js Terminal for an id (or undefined). Used by
   * features that need direct access to the terminal API (e.g. reading the
   * cursor position for autocomplete overlays). Do NOT use this to write data —
   * that must go through `bindInput`/the PTY writer.
   */
  getTerminal(id: string): Terminal | undefined {
    return this.entries.get(id)?.term;
  }

  /** The SearchAddon for a terminal, used by the Cmd+F find bar to highlight
   *  matches and jump between them. */
  getSearch(id: string): SearchAddon | undefined {
    return this.entries.get(id)?.search;
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

  private updateSensitiveInputState(entry: TerminalEntry, data: string): void {
    entry.outputTail = stripAnsi(`${entry.outputTail}${data}`).slice(-2000);
    const segments = entry.outputTail.split(/\r\n|\n|\r/);
    const currentLine = segments[segments.length - 1] ?? '';

    if (SENSITIVE_INPUT_PROMPT_RE.test(currentLine)) {
      entry.sensitiveInputActive = true;
      return;
    }

    if (entry.sensitiveInputActive && /[\r\n]/.test(data)) {
      entry.sensitiveInputActive = false;
    }
  }

  /**
   * Attach the IME insertText recovery listener for a terminal. Called once
   * after `bindInput`, but the textarea only exists after the terminal is
   * opened and focused, so we retry via rAF until it appears.
   *
   * Recovers characters that macOS Pinyin produces via `input(insertText)` for
   * Shift+symbol punctuation (？ “ —— …) but that xterm's internal `_inputEvent`
   * drops due to its `(!composed || !keyDownSeen)` guard when the input event
   * arrives before the matching keydown. See module-level comment for details.
   */
  private fixImeInsertText(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.imeAttachRaf) {
      cancelAnimationFrame(entry.imeAttachRaf);
      entry.imeAttachRaf = 0;
    }
    const tryAttach = (attempts = 0) => {
      entry.imeAttachRaf = 0;
      const ta = entry.term.textarea;
      if (ta) {
        this.installImeFix(entry, ta);
        return;
      }
      if (attempts < 60) {
        entry.imeAttachRaf = requestAnimationFrame(() => tryAttach(attempts + 1));
      }
    };
    tryAttach();
  }

  /** The actual recovery listener, attached to one textarea. Idempotent. */
  private installImeFix(entry: TerminalEntry, ta: HTMLTextAreaElement): void {
    if (entry.imeFix?.textarea === ta) return;
    this.disposeImeFix(entry);

    const imeTextarea = ta as HTMLTextAreaElement & { _ptImeFixed?: boolean };
    if (imeTextarea._ptImeFixed) return;
    imeTextarea._ptImeFixed = true;

    // Record every string xterm emits on onData. We compare this against the
    // IME's input(insertText) data to decide whether xterm already forwarded it
    // (→ leave alone) or swallowed it (→ recover, forwarding it ourselves).
    let onDataHits: string[] = [];
    const onDataDisposable = entry.term.onData((data) => {
      onDataHits.push(data);
    });

    const inputHandler = (ev: Event) => {
      const inputEvent = ev as InputEvent;
      // Only the IME "direct insert" path interests us; ordinary typing and
      // full composition events are already handled correctly by xterm.
      if (inputEvent.inputType !== 'insertText' || !inputEvent.data) return;
      const text: string = inputEvent.data;
      // Snapshot the hits collected so far and reset, then on the next
      // microtask check whether xterm emitted this exact text on onData.
      // (onData fires synchronously from _inputEvent, which runs before the
      //  microtask queue drains, so a microtask delay is enough to observe it.)
      const before = onDataHits;
      onDataHits = [];
      queueMicrotask(() => {
        if (before.includes(text)) return; // xterm delivered it — don't double-send.
        // xterm swallowed it: forward to the PTY writer + read-only subscribers,
        // mirroring the bindInput fan-out so autocomplete still sees it.
        entry.writer?.(text);
        for (const fn of entry.inputListeners) fn(text);
        // Clear the textarea's residual value so it can't be re-read or echoed.
        // xterm maintains its own buffer; this element is only an IME surface.
        if (ta.value) ta.value = '';
      });
    };

    ta.addEventListener(
      'input',
      inputHandler,
      true // capture phase, before xterm's own listeners (defensive).
    );
    entry.imeFix = { textarea: ta, inputHandler, onDataDisposable };
  }

  private disposeImeFix(entry: TerminalEntry): void {
    if (entry.imeAttachRaf) {
      cancelAnimationFrame(entry.imeAttachRaf);
      entry.imeAttachRaf = 0;
    }
    if (!entry.imeFix) return;

    const { textarea, inputHandler, onDataDisposable } = entry.imeFix;
    textarea.removeEventListener('input', inputHandler, true);
    onDataDisposable.dispose();
    delete (textarea as HTMLTextAreaElement & { _ptImeFixed?: boolean })._ptImeFixed;
    entry.imeFix = undefined;
  }
}

export const terminalRegistry = new TerminalRegistry();

const SENSITIVE_INPUT_PROMPT_RE =
  /\b(password|passphrase|passwd|verification code|one[-\s]?time|otp|2fa|two[-\s]?factor|token|secret|pin)\b.*[:：]\s*$|(?:密码|口令|验证码|动态码|令牌|密钥|私钥).*[:：]\s*$/i;

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

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

// macOS 系统拼音 IME 丢字符修复的实现见 TerminalRegistry.installImeFix（class 内）。
// 注释说明保留在这里：现象是 Shift+符号（? “ ——）大部分时间需按 2 次；根因是
// xterm 的 _inputEvent 守卫在 input(insertText, composed=true) 先于 keydown 到达
// 时把字符判定为重复而丢弃，onData 不触发。修复用 microtask 检查 onData 是否跟随，
// 没跟随时补发字符到 PTY，已投递则不动——保证不双发。
