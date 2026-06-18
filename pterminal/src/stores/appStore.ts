import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import type { Terminal, Command, AIMessage, AIConfig, SshShortcut } from '@/types';
import { terminalService } from '@/services/terminalService';
import { terminalRegistry } from '@/services/terminalRegistry';
import {
  commandService,
  type CreateCommandInput,
} from '@/services/commandService';
import { sshService, type CreateSshShortcutInput, type UpdateSshShortcutInput } from '@/services/sshService';
import { aiService } from '@/services/aiService';
import { settingsService, SETTING_KEYS } from '@/services/settingsService';
import { dismissTerminalAutocomplete } from '@/services/autocompleteEvents';
import { toast } from '@/stores/toastStore';

/** Terminal font defaults (used when no saved preference exists). */
export const DEFAULT_FONT_FAMILY = "'SF Mono', 'Monaco', 'Consolas', monospace";
export const DEFAULT_FONT_SIZE = 13;
export const DEFAULT_LINE_HEIGHT = 1;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;

interface AppState {
  // Terminal state
  terminals: Terminal[];
  activeTerminalId: string | null;

  // Auxiliary data for active terminal
  commonCommands: Command[];
  aiMessages: AIMessage[];
  /** Total non-empty AI messages for the active terminal (may exceed aiMessages.length when truncated). */
  aiMessagesTotal: number;
  // SSH shortcuts (global, shared across terminals)
  sshShortcuts: SshShortcut[];

  // AI state
  aiConfig: AIConfig | null;
  isAiStreaming: boolean;
  /** Request id of the in-flight AI stream, if any. Used to call `ai_cancel`.
   * Set by `startAiTurn`, cleared by `finishAiTurn`. */
  activeAiRequestId: string | null;
  /** Terminal that owns the in-flight AI stream. */
  activeAiTerminalId: string | null;
  /** In-flight AI request ids by terminal id. */
  aiStreams: Record<string, string>;

  // UI state
  leftWidth: number;
  rightWidth: number;
  isDarkMode: boolean;
  isRightPanelVisible: boolean;
  isLeftPanelVisible: boolean;
  /** Whether the left panel overlay is showing (hover preview when collapsed). */
  isLeftPanelHovering: boolean;
  /** Whether the main window is currently in native macOS fullscreen.
   *  Updated from the `tauri://resize` listener in App.tsx; the top bar uses
   *  it to drop the traffic-light gutter in fullscreen (需求 2). */
  isFullscreen: boolean;
  /** Apply the current fullscreen state (drives top-bar layout). */
  setFullscreen: (v: boolean) => void;

  // Top-level view switch
  activeView: 'terminal' | 'settings';
  setActiveView: (view: 'terminal' | 'settings') => void;  // --- Selection / persistence ---
  setActiveTerminal: (id: string | null) => void;
  /** Ensure the terminal has a live PTY session, spawning one (restore) if missing. */
  ensureSession: (id: string) => Promise<void>;
  loadTerminals: () => Promise<void>;
  createTerminal: (opts?: { name?: string; cwd?: string }) => Promise<string | null>;
  deleteTerminal: (id: string) => Promise<void>;
  /** Handle a shell that exited naturally (e.g. user typed `exit`). Removes
   *  the terminal from the sidebar/store/DB. No-op if the terminal is already
   *  gone (manual delete fires a duplicate `terminal-exit` after the kill). */
  handleTerminalExit: (id: string) => void;
  renameTerminal: (id: string, name: string) => Promise<void>;
  /** Toggle the pinned state of a terminal and re-sort the list. */
  togglePinTerminal: (terminal: Terminal) => Promise<void>;

  // --- Commands (common) ---
  loadCommands: (terminalId: string) => Promise<void>;
  addCommand: (input: CreateCommandInput) => Promise<void>;
  editCommand: (id: string, updates: { label?: string; command?: string }) => Promise<void>;
  removeCommand: (id: string) => Promise<void>;
  togglePinCommand: (command: Command) => Promise<void>;

  // --- Custom completions (global, terminal_id NULL) ---
  customCompletions: Command[];
  loadCustomCompletions: () => Promise<void>;
  addCustomCompletion: (input: { label?: string; command: string }) => Promise<void>;
  editCustomCompletion: (id: string, updates: { label?: string; command?: string }) => Promise<void>;
  removeCustomCompletion: (id: string) => Promise<void>;

  // --- Commands to the live terminal ---
  sendCommand: (terminalId: string, command: string) => Promise<void>;

  // --- SSH shortcuts ---
  loadSshShortcuts: () => Promise<void>;
  addSshShortcut: (input: CreateSshShortcutInput) => Promise<void>;
  editSshShortcut: (
    id: string,
    updates: Omit<UpdateSshShortcutInput, 'id'>
  ) => Promise<void>;
  removeSshShortcut: (id: string) => Promise<void>;
  /** Open a new terminal and run the ssh command for this shortcut. */
  openSshShortcut: (shortcut: SshShortcut) => Promise<void>;

  // --- AI ---
  loadAiConfig: () => Promise<void>;
  saveAiConfig: (settings: Partial<AIConfig> & { apiKey?: string }) => Promise<void>;
  loadAiMessages: (terminalId: string) => Promise<void>;
  /** Clear all AI messages for a terminal (reset conversation). */
  clearAiMessages: (terminalId: string) => Promise<void>;
  /** Start a new assistant turn as an empty streaming placeholder. */
  startAiTurn: (terminalId: string, userText: string, kind: string, requestId: string) => void;
  /** Append a streamed delta to the latest assistant message. */
  appendAiDelta: (delta: string) => void;
  /** Mark the current stream finished (optionally with an error). */
  finishAiTurn: (error?: string, terminalId?: string) => void;
  /** Re-run a suggested command in the active terminal. */
  runSuggestedCommand: (terminalId: string, command: string) => Promise<void>;

  // --- Layout / theme ---
  /** Apply a delta (px) to the left panel width, clamped to [MIN, MAX]. */
  setLeftWidth: (delta: number) => void;
  /** Apply a delta (px) to the right panel width, clamped to [MIN, MAX]. */
  setRightWidth: (delta: number) => void;
  /** Persist the current panel widths to settings (call on drag end). */
  persistPanelWidths: () => void;
  toggleDarkMode: () => void;
  toggleRightPanel: () => void;
  toggleLeftPanel: () => void;
  /** Show/hide the left panel overlay (hover preview). Clears any pending
   *  hide timer so a direct show is never cancelled by a stale leave. */
  setLeftPanelHovering: (hovering: boolean) => void;
  /** Arm (or replace) the shared hide timer for the left panel overlay. The
   *  timer is shared with the toggle button so a pending hide started when
   *  leaving the button is cancelled once the mouse reaches the overlay. */
  scheduleLeftPanelHoverHide: (delayMs?: number) => void;
  /** Cancel the shared hide timer (e.g. when the mouse enters the overlay). */
  cancelLeftPanelHoverHide: () => void;
  setAiMessages: (messages: AIMessage[]) => void;
  /** Restore saved UI state (panel visibility, theme, widths) on startup. */
  loadUiState: () => Promise<void>;

  // --- Terminal appearance ---
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Whether terminal autocomplete UI is enabled at all. */
  terminalAutocompleteEnabled: boolean;
  /** Whether AI enhancement for autocomplete is enabled. */
  autocompleteEnabled: boolean;
  /** Load saved font family/size from the settings table. */
  loadAppearance: () => Promise<void>;
  /** Persist terminal autocomplete enabled/disabled preference. */
  setTerminalAutocompleteEnabled: (enabled: boolean) => Promise<void>;
  /** Persist AI autocomplete enhancement enabled/disabled preference. */
  setAutocompleteEnabled: (enabled: boolean) => Promise<void>;
  /** Persist and apply a new font family to all live terminals. */
  setTerminalFontFamily: (family: string) => Promise<void>;
  /** Adjust the ACTIVE terminal's font size by a delta (clamped), persist per-terminal. */
  adjustTerminalFontSize: (delta: number) => Promise<void>;
  /** Set the global default font size (used by new terminals and those without an override). */
  setDefaultFontSize: (size: number) => Promise<void>;
  /** Set the line height multiplier (applied globally). */
  setLineHeight: (lineHeight: number) => Promise<void>;
}

const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH = 350;
const DEFAULT_LEFT_WIDTH = 280;
const DEFAULT_RIGHT_WIDTH = 320;

/**
 * Shared hide-timer for the left-panel hover overlay. It lives at module scope
 * (not in reactive state) so BOTH the top-bar toggle button and the overlay
 * itself coordinate against the same pending hide — leaving the button arms
 * it, entering the overlay cancels it. This is what keeps the overlay open as
 * the mouse travels from the button down onto it.
 */
let leftPanelHoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearLeftPanelHoverTimer() {
  if (leftPanelHoverTimer) {
    clearTimeout(leftPanelHoverTimer);
    leftPanelHoverTimer = null;
  }
}

/**
 * Apply a dark/light theme to the document + re-theme every live xterm.
 * Shared by `toggleDarkMode` (runtime) and `loadUiState` (startup restore) so
 * both paths flip CSS variables and repaint terminals identically.
 */
function applyTheme(isDark: boolean) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  requestAnimationFrame(() => {
    terminalRegistry.rethemeAll();
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  terminals: [],
  activeTerminalId: null,
  commonCommands: [],
  customCompletions: [],
  aiMessages: [],
  aiMessagesTotal: 0,
  sshShortcuts: [],
  aiConfig: null,
  isAiStreaming: false,
  activeAiRequestId: null,
  activeAiTerminalId: null,
  aiStreams: {},
  leftWidth: DEFAULT_LEFT_WIDTH,
  rightWidth: DEFAULT_RIGHT_WIDTH,
  isDarkMode: true,
  isRightPanelVisible: false,
  isLeftPanelVisible: true,
  isLeftPanelHovering: false,
  isFullscreen: false,
  activeView: 'terminal',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  lineHeight: DEFAULT_LINE_HEIGHT,
  terminalAutocompleteEnabled: false,
  autocompleteEnabled: false,

  setActiveTerminal: (id) => {
    dismissTerminalAutocomplete();
    const requestId = id ? get().aiStreams[id] ?? null : null;
    set({
      activeTerminalId: id,
      isAiStreaming: Boolean(requestId),
      activeAiRequestId: requestId,
      activeAiTerminalId: requestId ? id : null,
    });
    if (id) {
      void get().ensureSession(id);
      // Restore this terminal's own font size onto its xterm instance.
      const t = get().terminals.find((x) => x.id === id);
      const size = t?.fontSize ?? get().fontSize;
      terminalRegistry.applyFont(id, get().fontFamily, size);
    }
    // Persist the selection so it can be restored on next launch (需求 2).
    void settingsService.set(SETTING_KEYS.activeTerminalId, id ?? '').catch(() => {});
  },

  ensureSession: async (id) => {
    try {
      const has = await terminalService.hasSession(id);
      if (!has) {
        // Re-attach a live PTY using the persisted config (restore mode).
        await terminalService.spawn({ id, cols: 80, rows: 24 });
      }
    } catch (err) {
      console.error('Failed to ensure session:', err);
    }
  },

  loadTerminals: async () => {
    const terminals = (await terminalService.list()).sort(compareTerminals);
    set({ terminals });
    if (!get().activeTerminalId && terminals.length > 0) {
      // Restore the last-selected terminal if it still exists (需求 2),
      // otherwise fall back to the most recently created one.
      const savedId = await settingsService.get(SETTING_KEYS.activeTerminalId);
      const target = savedId && terminals.some((t) => t.id === savedId)
        ? savedId
        : terminals[terminals.length - 1].id;
      get().setActiveTerminal(target);
    }
  },

  createTerminal: async (opts) => {
    dismissTerminalAutocomplete();
    try {
      const terminal = await terminalService.spawn({
        name: opts?.name,
        cwd: opts?.cwd,
        cols: 80,
        rows: 24,
      });
      set((state) => ({
        terminals: [...state.terminals, terminal].sort(compareTerminals),
        activeTerminalId: terminal.id,
        commonCommands: [],
      }));
      return terminal.id;
    } catch (err) {
      toast.error('Failed to create terminal'); console.error(err);
      return null;
    }
  },

  deleteTerminal: async (id) => {
    try {
      await terminalService.remove(id);
      terminalRegistry.dispose(id);
      set((state) => {
        const filtered = state.terminals.filter((t) => t.id !== id);
        const newActive =
          state.activeTerminalId === id
            ? filtered.length > 0
              ? filtered[filtered.length - 1].id
              : null
            : state.activeTerminalId;
        return { terminals: filtered, activeTerminalId: newActive };
      });
    } catch (err) {
      toast.error('Failed to delete terminal'); console.error(err);
    }
  },

  handleTerminalExit: (id) => {
    // Ghost-event guard: a manual delete (deleteTerminal → terminal_delete →
    // kill child) also makes the reader emit terminal-exit, but by then the
    // terminal is already removed from the store. Skip in that case to avoid
    // a redundant remove/dispose on an absent id.
    if (!get().terminals.some((t) => t.id === id)) return;
    void get().deleteTerminal(id);
  },

  renameTerminal: async (id, name) => {
    try {
      const updated = await terminalService.update(id, { name });
      set((state) => ({
        terminals: state.terminals.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (err) {
      toast.error('Failed to rename terminal'); console.error(err);
    }
  },

  togglePinTerminal: async (terminal) => {
    try {
      const updated = await terminalService.pin({
        id: terminal.id,
        isPinned: !terminal.isPinned,
      });
      set((state) => ({
        terminals: state.terminals
          .map((t) => (t.id === terminal.id ? updated : t))
          .sort(compareTerminals),
      }));
    } catch (err) {
      toast.error('Failed to pin terminal'); console.error(err);
    }
  },

  loadCommands: async (terminalId) => {
    try {
      const commands = await commandService.list(terminalId);
      set({ commonCommands: commands });
    } catch (err) {
      console.error('Failed to load commands:', err);
    }
  },

  addCommand: async (input) => {
    try {
      const created = await commandService.create(input);
      set((state) => ({ commonCommands: [...state.commonCommands, created] }));
    } catch (err) {
      toast.error('Failed to add command'); console.error(err);
    }
  },

  editCommand: async (id, updates) => {
    try {
      const updated = await commandService.update({ id, ...updates });
      set((state) => ({
        commonCommands: state.commonCommands.map((c) =>
          c.id === id ? updated : c
        ),
      }));
    } catch (err) {
      toast.error('Failed to update command'); console.error(err);
    }
  },

  removeCommand: async (id) => {
    try {
      await commandService.remove(id);
      set((state) => ({
        commonCommands: state.commonCommands.filter((c) => c.id !== id),
      }));
    } catch (err) {
      toast.error('Failed to delete command'); console.error(err);
    }
  },

  togglePinCommand: async (command) => {
    try {
      const updated = await commandService.pin({
        id: command.id,
        isPinned: !command.isPinned,
      });
      set((state) => ({
        commonCommands: state.commonCommands
          .map((c) => (c.id === command.id ? updated : c))
          .sort(compareCommands),
      }));
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  },

  sendCommand: async (terminalId, command) => {
    await terminalService.write(terminalId, command + '\r');
  },

  loadCustomCompletions: async () => {
    try {
      const customCompletions = await commandService.listGlobal();
      set({ customCompletions });
    } catch (err) {
      console.error('Failed to load custom completions:', err);
    }
  },

  addCustomCompletion: async (input) => {
    try {
      const created = await commandService.create({
        terminalId: undefined,
        label: input.label?.trim() || input.command.trim(),
        command: input.command.trim(),
      });
      set((state) => ({ customCompletions: [...state.customCompletions, created] }));
    } catch (err) {
      toast.error('Failed to add custom completion'); console.error(err);
    }
  },

  editCustomCompletion: async (id, updates) => {
    try {
      const updated = await commandService.update({ id, ...updates });
      set((state) => ({
        customCompletions: state.customCompletions.map((c) => (c.id === id ? updated : c)),
      }));
    } catch (err) {
      toast.error('Failed to update custom completion'); console.error(err);
    }
  },

  removeCustomCompletion: async (id) => {
    try {
      await commandService.remove(id);
      set((state) => ({
        customCompletions: state.customCompletions.filter((c) => c.id !== id),
      }));
    } catch (err) {
      toast.error('Failed to delete custom completion'); console.error(err);
    }
  },

  loadSshShortcuts: async () => {
    try {
      const sshShortcuts = await sshService.list();
      set({ sshShortcuts });
    } catch (err) {
      console.error('Failed to load SSH shortcuts:', err);
    }
  },

  addSshShortcut: async (input) => {
    try {
      const created = await sshService.create(input);
      set((state) => ({ sshShortcuts: [...state.sshShortcuts, created] }));
    } catch (err) {
      toast.error('Failed to add SSH shortcut'); console.error(err);
    }
  },

  editSshShortcut: async (id, updates) => {
    try {
      const updated = await sshService.update({ id, ...updates });
      set((state) => ({
        sshShortcuts: state.sshShortcuts.map((s) => (s.id === id ? updated : s)),
      }));
    } catch (err) {
      toast.error('Failed to update SSH shortcut'); console.error(err);
    }
  },

  removeSshShortcut: async (id) => {
    try {
      await sshService.remove(id);
      set((state) => ({
        sshShortcuts: state.sshShortcuts.filter((s) => s.id !== id),
      }));
    } catch (err) {
      toast.error('Failed to delete SSH shortcut'); console.error(err);
    }
  },

  openSshShortcut: async (shortcut) => {
    dismissTerminalAutocomplete();
    try {
      const parts: string[] = [];
      // When a password is saved, wrap ssh with sshpass so login is automatic.
      // We use -p (password as argument); this means the password is visible
      // in the process list (`ps`) for the brief connection lifetime, but it
      // never echoes into the terminal scrollback. Acceptable for internal/
      // test hosts — the field is labelled as plaintext in settings.
      if (shortcut.password) {
        parts.push('sshpass', '-p', shellQuote(shortcut.password));
      }
      parts.push('ssh');
      if (shortcut.port && shortcut.port !== 22) {
        parts.push('-p', shellQuote(String(shortcut.port)));
      }
      if (shortcut.identityFile) {
        parts.push('-i', shellQuote(shortcut.identityFile));
      }
      parts.push(shellQuote(`${shortcut.user}@${shortcut.host}`));
      const sshCommand = parts.join(' ');
      // Spawn a fresh terminal and auto-run the ssh command in it.
      const id = await get().createTerminal({ name: shortcut.name });
      if (id) {
        // Wait until the shell has actually started before sending the SSH
        // command. A fixed delay is racy: under load the shell may not be
        // ready in 150ms and the keystrokes get lost. Instead we listen for
        // the terminal's first output (the shell prints its prompt on start)
        // and send then. A 3s timeout is a safety net in case the shell
        // produces no output (unusual).
        let sent = false;
        const send = async () => {
          if (sent) return;
          sent = true;
          await terminalService.write(id, sshCommand + '\r');
        };
        const unlisten = await listen<{ id: string }>('terminal-data', (event) => {
          if (event.payload.id === id) {
            void send();
            unlisten();
          }
        });
        // Fallback: if no output arrives within 3s, send anyway.
        setTimeout(() => {
          unlisten();
          void send();
        }, 3000);
      }
    } catch (err) {
      toast.error('Failed to open SSH session'); console.error(err);
    }
  },

  loadAiConfig: async () => {
    try {
      const config = await aiService.config();
      set({ aiConfig: config });
    } catch (err) {
      console.error('Failed to load AI config:', err);
    }
  },

  saveAiConfig: async (settings) => {
    try {
      await aiService.saveSettings(settings);
      await get().loadAiConfig();
    } catch (err) {
      toast.error('Failed to save AI settings'); console.error(err);
    }
  },

  loadAiMessages: async (terminalId) => {
    try {
      const { messages, total } = await aiService.messages(terminalId);
      set({ aiMessages: messages, aiMessagesTotal: total });
    } catch (err) {
      console.error('Failed to load AI messages:', err);
    }
  },

  clearAiMessages: async (terminalId) => {
    try {
      await aiService.clearMessages(terminalId);
      set({ aiMessages: [], aiMessagesTotal: 0 });
    } catch (err) {
      toast.error('Failed to clear AI messages'); console.error(err);
    }
  },

  startAiTurn: (terminalId, userText, kind, requestId) => {
    const now = Date.now();
    const userMsg: AIMessage = {
      id: `tmp-u-${now}`,
      terminalId,
      role: 'user',
      content: userText,
      messageType: kind as AIMessage['messageType'],
      createdAt: now,
    };
    const assistantMsg: AIMessage = {
      id: `tmp-a-${now}`,
      terminalId,
      role: 'assistant',
      content: '',
      messageType: kind as AIMessage['messageType'],
      createdAt: now + 1,
    };
    set((state) => ({
      aiMessages: [...state.aiMessages, userMsg, assistantMsg],
      isAiStreaming: true,
      activeAiRequestId: requestId,
      activeAiTerminalId: terminalId,
      aiStreams: { ...state.aiStreams, [terminalId]: requestId },
    }));
  },

  appendAiDelta: (delta) =>
    set((state) => {
      const msgs = [...state.aiMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta };
      }
      return { aiMessages: msgs };
    }),

  finishAiTurn: (error, terminalId) =>
    set((state) => {
      const nextStreams = { ...state.aiStreams };
      if (terminalId) delete nextStreams[terminalId];

      if (terminalId && terminalId !== state.activeTerminalId) {
        return {
          aiStreams: nextStreams,
          isAiStreaming: Boolean(state.activeTerminalId && nextStreams[state.activeTerminalId]),
          activeAiRequestId: state.activeTerminalId ? nextStreams[state.activeTerminalId] ?? null : null,
          activeAiTerminalId:
            state.activeTerminalId && nextStreams[state.activeTerminalId]
              ? state.activeTerminalId
              : null,
        };
      }

      const msgs = [...state.aiMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && error) {
        msgs[msgs.length - 1] = {
          ...last,
          content: last.content || `⚠ ${error}`,
        };
      }
      return {
        aiMessages: msgs,
        aiStreams: nextStreams,
        isAiStreaming: Boolean(state.activeTerminalId && nextStreams[state.activeTerminalId]),
        activeAiRequestId: state.activeTerminalId ? nextStreams[state.activeTerminalId] ?? null : null,
        activeAiTerminalId:
          state.activeTerminalId && nextStreams[state.activeTerminalId]
            ? state.activeTerminalId
            : null,
      };
    }),

  runSuggestedCommand: async (terminalId, command) => {
    await terminalService.write(terminalId, command + '\r');
  },

  // Reads the live current width via get() so a dragging Resizer can fire many
  // small deltas without re-rendering its own closure between them.
  setLeftWidth: (delta) =>
    set({
      leftWidth: Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, get().leftWidth + delta)
      ),
    }),

  setRightWidth: (delta) =>
    set({
      rightWidth: Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, get().rightWidth + delta)
      ),
    }),

  toggleDarkMode: () =>
    set((state) => {
      const newMode = !state.isDarkMode;
      applyTheme(newMode);
      // Persist so the theme survives restart (需求 2).
      void settingsService.set(SETTING_KEYS.isDarkMode, newMode ? '1' : '0').catch(() => {});
      return { isDarkMode: newMode };
    }),

  setFullscreen: (v) => set({ isFullscreen: v }),

  toggleRightPanel: () =>
    set((state) => {
      const next = !state.isRightPanelVisible;
      void settingsService.set(SETTING_KEYS.rightPanelVisible, next ? '1' : '0').catch(() => {});
      return { isRightPanelVisible: next };
    }),

  toggleLeftPanel: () =>
    set((state) => {
      const next = !state.isLeftPanelVisible;
      void settingsService.set(SETTING_KEYS.leftPanelVisible, next ? '1' : '0').catch(() => {});
      // Expanding the panel makes the hover overlay moot; drop any pending hide.
      if (next) clearLeftPanelHoverTimer();
      return { isLeftPanelVisible: next, isLeftPanelHovering: false };
    }),

  setLeftPanelHovering: (hovering) => {
    clearLeftPanelHoverTimer();
    set({ isLeftPanelHovering: hovering });
  },

  scheduleLeftPanelHoverHide: (delayMs) => {
    clearLeftPanelHoverTimer();
    leftPanelHoverTimer = setTimeout(() => {
      leftPanelHoverTimer = null;
      set({ isLeftPanelHovering: false });
    }, delayMs ?? 300);
  },

  cancelLeftPanelHoverHide: () => {
    clearLeftPanelHoverTimer();
  },

  // Persist the current panel widths. Called on drag end (mouseup) rather than
  // every mousemove to avoid hammering SQLite during a resize (需求 2).
  persistPanelWidths: () => {
    const { leftWidth, rightWidth } = get();
    void settingsService.set(SETTING_KEYS.leftWidth, String(leftWidth)).catch(() => {});
    void settingsService.set(SETTING_KEYS.rightWidth, String(rightWidth)).catch(() => {});
  },

  loadUiState: async () => {
    try {
      const [leftVis, rightVis, dark, leftW, rightW] = await Promise.all([
        settingsService.get(SETTING_KEYS.leftPanelVisible),
        settingsService.get(SETTING_KEYS.rightPanelVisible),
        settingsService.get(SETTING_KEYS.isDarkMode),
        settingsService.get(SETTING_KEYS.leftWidth),
        settingsService.get(SETTING_KEYS.rightWidth),
      ]);
      const patch: Partial<AppState> = {};
      if (leftVis !== null) patch.isLeftPanelVisible = leftVis === '1';
      if (rightVis !== null) patch.isRightPanelVisible = rightVis === '1';
      if (dark !== null) {
        patch.isDarkMode = dark === '1';
        // Apply the restored theme to the DOM + xterm instances.
        applyTheme(patch.isDarkMode);
      }
      const lw = leftW ? Number(leftW) : 0;
      if (lw >= MIN_PANEL_WIDTH && lw <= MAX_PANEL_WIDTH) patch.leftWidth = lw;
      const rw = rightW ? Number(rightW) : 0;
      if (rw >= MIN_PANEL_WIDTH && rw <= MAX_PANEL_WIDTH) patch.rightWidth = rw;
      set(patch);
    } catch (err) {
      console.error('Failed to load UI state:', err);
    }
  },

  // --- Terminal appearance ---
  loadAppearance: async () => {
    try {
      const [family, size, lineHeight, terminalAcEnabled, aiAcEnabled] = await Promise.all([
        settingsService.get(SETTING_KEYS.fontFamily),
        settingsService.get(SETTING_KEYS.fontSize),
        settingsService.get(SETTING_KEYS.lineHeight),
        settingsService.get(SETTING_KEYS.terminalAutocompleteEnabled),
        settingsService.get(SETTING_KEYS.autocompleteEnabled),
      ]);
      const next = {
        fontFamily: family || DEFAULT_FONT_FAMILY,
        fontSize: size ? Number(size) || DEFAULT_FONT_SIZE : DEFAULT_FONT_SIZE,
        lineHeight: lineHeight ? Number(lineHeight) || DEFAULT_LINE_HEIGHT : DEFAULT_LINE_HEIGHT,
        // Default to disabled when the key is absent (first launch).
        terminalAutocompleteEnabled: terminalAcEnabled === null ? false : terminalAcEnabled === '1',
        autocompleteEnabled: aiAcEnabled === null ? false : aiAcEnabled === '1',
      };
      set(next);
      // Font family is global; font size is per-terminal. Apply the family to
      // every terminal, preserving each terminal's own size override.
      const { terminals } = get();
      for (const t of terminals) {
        terminalRegistry.applyFont(t.id, next.fontFamily, t.fontSize ?? next.fontSize, next.lineHeight);
      }
    } catch (err) {
      console.error('Failed to load appearance:', err);
    }
  },

  setTerminalAutocompleteEnabled: async (enabled) => {
    const previous = get().terminalAutocompleteEnabled;
    set({ terminalAutocompleteEnabled: enabled });
    try {
      await settingsService.set(SETTING_KEYS.terminalAutocompleteEnabled, enabled ? '1' : '0');
    } catch (err) {
      set({ terminalAutocompleteEnabled: previous });
      console.error('Failed to save terminal autocomplete enabled:', err);
    }
  },

  setAutocompleteEnabled: async (enabled) => {
    const previous = get().autocompleteEnabled;
    set({ autocompleteEnabled: enabled });
    try {
      await settingsService.set(SETTING_KEYS.autocompleteEnabled, enabled ? '1' : '0');
    } catch (err) {
      set({ autocompleteEnabled: previous });
      console.error('Failed to save autocomplete enabled:', err);
    }
  },

  setTerminalFontFamily: async (family) => {
    const value = family.trim() || DEFAULT_FONT_FAMILY;
    set({ fontFamily: value });
    // Font family is global, but each terminal keeps its own font size —
    // apply the new family to every terminal with its own size.
    const { terminals, fontSize: defaultSize } = get();
    for (const t of terminals) {
      terminalRegistry.applyFont(t.id, value, t.fontSize ?? defaultSize);
    }
    try {
      await settingsService.set(SETTING_KEYS.fontFamily, value);
    } catch (err) {
      console.error('Failed to save font family:', err);
    }
  },

  adjustTerminalFontSize: async (delta) => {
    // Font size is per-terminal: zoom only affects the active terminal.
    const { activeTerminalId, terminals, fontFamily, fontSize: defaultSize } = get();
    if (!activeTerminalId) return;
    const t = terminals.find((x) => x.id === activeTerminalId);
    if (!t) return;
    const current = t.fontSize ?? defaultSize;
    const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, current + delta));
    if (next === current) return;
    // Update the terminal record in-store and apply to its xterm instance.
    set({
      terminals: terminals.map((x) =>
        x.id === activeTerminalId ? { ...x, fontSize: next } : x
      ),
    });
    terminalRegistry.applyFont(activeTerminalId, fontFamily, next);
    try {
      await terminalService.setFontSize({ id: activeTerminalId, fontSize: next });
    } catch (err) {
      console.error('Failed to save terminal font size:', err);
    }
  },

  setDefaultFontSize: async (size) => {
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
    set({ fontSize: clamped });
    // Apply to every terminal that has no per-terminal override (those keep
    // their own size); also re-apply to overridden ones so the family stays.
    const { terminals, fontFamily } = get();
    for (const t of terminals) {
      terminalRegistry.applyFont(t.id, fontFamily, t.fontSize ?? clamped);
    }
    try {
      await settingsService.set(SETTING_KEYS.fontSize, String(clamped));
    } catch (err) {
      console.error('Failed to save default font size:', err);
    }
  },

  setLineHeight: async (lineHeight) => {
    const clamped = Math.max(0.8, Math.min(2.0, lineHeight));
    set({ lineHeight: clamped });
    // Apply to all terminals
    const { terminals, fontFamily, fontSize } = get();
    for (const t of terminals) {
      terminalRegistry.applyFont(t.id, fontFamily, t.fontSize ?? fontSize, clamped);
    }
    try {
      await settingsService.set(SETTING_KEYS.lineHeight, String(clamped));
    } catch (err) {
      console.error('Failed to save line height:', err);
    }
  },

  setActiveView: (view) => set({ activeView: view }),

  setAiMessages: (messages) => set({ aiMessages: messages }),
}));

/** Sort: pinned first (by pinOrder), then by createdAt. */
function compareCommands(a: Command, b: Command): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  if (a.isPinned && b.isPinned && a.pinOrder !== b.pinOrder) {
    return a.pinOrder - b.pinOrder;
  }
  return a.createdAt - b.createdAt;
}

/** Sort terminals: pinned first (by pinOrder), then by createdAt. */
function compareTerminals(a: Terminal, b: Terminal): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  if (a.isPinned && b.isPinned && a.pinOrder !== b.pinOrder) {
    return a.pinOrder - b.pinOrder;
  }
  return a.createdAt - b.createdAt;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
