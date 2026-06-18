import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { aiService } from '@/services/aiService';
import { terminalRegistry } from '@/services/terminalRegistry';
import { terminalService } from '@/services/terminalService';
import { onTerminalAutocompleteDismiss } from '@/services/autocompleteEvents';
import { useAppStore } from '@/stores/appStore';

/** Result event from the Rust backend (non-streaming autocomplete). */
interface AutocompleteResultPayload {
  requestId: string;
  terminalId: string;
  suggestions?: string[];
  error?: string;
}

interface AutocompleteState {
  /** Suggested FULL commands (e.g. ["git status", "git stash"]). */
  suggestions: string[];
  /** Currently highlighted candidate index. */
  selectedIndex: number;
  /** Whether the popup / ghost text is visible. */
  visible: boolean;
  /** Whether an AI enhancement request is in-flight. */
  loading: boolean;
  /** The request id of the in-flight AI autocomplete request. */
  requestId: string | null;
  /** The current input line text (what the user has typed). */
  currentInput: string;
  /** Predicted cursor cell based on the local keystroke buffer. */
  cursorX: number | null;
  cursorY: number | null;
}

const AI_DEBOUNCE_MS = 850;
const LOCAL_DEBOUNCE_MS = 80;
const MIN_LOCAL_INPUT_LENGTH = 1;
const MIN_AI_INPUT_LENGTH = 3;
/** Max menu items shown at once; the rest scroll. */
const MAX_VISIBLE_ITEMS = 6;
const MAX_COMMAND_HISTORY = 100;
const REMOTE_COMMON_COMMANDS = [
  'apt',
  'apt-get',
  'cat',
  'chmod',
  'chown',
  'cp',
  'curl',
  'df',
  'docker',
  'docker compose',
  'du',
  'find',
  'grep',
  'head',
  'htop',
  'journalctl',
  'less',
  'ls',
  'mkdir',
  'mv',
  'nginx',
  'ping',
  'ps',
  'pwd',
  'rm',
  'rsync',
  'sed',
  'service',
  'sudo',
  'systemctl',
  'tail',
  'tar',
  'top',
  'touch',
  'ufw',
  'vim',
  'wget',
];

interface CursorCell {
  x: number;
  y: number;
}

/**
 * Hook that provides terminal autocomplete.
 *
 * The fast path is local: saved commands, executable names, shell builtins,
 * common subcommands, and filesystem paths. AI is only a delayed enhancement
 * when local candidates are sparse or the input looks semantic/argument-heavy.
 */
export function useTerminalAutocomplete(terminalId: string) {
  const terminalAutocompleteEnabled = useAppStore((s) => s.terminalAutocompleteEnabled);
  const aiAutocompleteEnabled = useAppStore((s) => s.autocompleteEnabled);
  const [state, setState] = useState<AutocompleteState>({
    suggestions: [],
    selectedIndex: 0,
    visible: false,
    loading: false,
    requestId: null,
    currentInput: '',
    cursorX: null,
    cursorY: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const aiDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputBufferRef = useRef('');
  const inputStartRef = useRef<CursorCell | null>(null);
  const localSeqRef = useRef(0);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  /** Commands executed in this terminal only, newest first. */
  const commandHistoryRef = useRef<string[]>([]);
  /** Commands executed after entering an SSH session, newest first. */
  const remoteCommandHistoryRef = useRef<string[]>([]);
  /** Best-effort flag: after `ssh ...`, avoid local PATH/filesystem completions. */
  const remoteSessionRef = useRef(false);
  /** Cached AI candidates from the last successful AI reply. */
  const cachedAiSuggestionsRef = useRef<string[]>([]);

  const cancelRequest = useCallback((requestId: string) => {
    void aiService.cancel(requestId);
  }, []);

  const clearAiTimer = useCallback(() => {
    if (aiDebounceTimerRef.current) {
      clearTimeout(aiDebounceTimerRef.current);
      aiDebounceTimerRef.current = null;
    }
  }, []);

  const clearLocalTimer = useCallback(() => {
    if (localDebounceTimerRef.current) {
      clearTimeout(localDebounceTimerRef.current);
      localDebounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (terminalAutocompleteEnabled) return;
    clearAiTimer();
    clearLocalTimer();
    localSeqRef.current += 1;
    const requestId = stateRef.current.requestId;
    if (requestId) cancelRequest(requestId);
    setState((s) => ({
      ...s,
      suggestions: [],
      selectedIndex: 0,
      visible: false,
      loading: false,
      requestId: null,
    }));
  }, [terminalAutocompleteEnabled, cancelRequest, clearAiTimer, clearLocalTimer]);

  useEffect(() => {
    if (aiAutocompleteEnabled) return;
    clearAiTimer();
    const requestId = stateRef.current.requestId;
    if (requestId) cancelRequest(requestId);
    setState((s) => ({
      ...s,
      loading: false,
      requestId: null,
    }));
  }, [aiAutocompleteEnabled, cancelRequest, clearAiTimer]);

  const dismiss = useCallback(() => {
    clearAiTimer();
    clearLocalTimer();
    const requestId = stateRef.current.requestId;
    if (requestId) cancelRequest(requestId);
    setState((s) => ({
      ...s,
      suggestions: [],
      selectedIndex: 0,
      visible: false,
      loading: false,
      requestId: null,
    }));
  }, [cancelRequest, clearAiTimer, clearLocalTimer]);

  /** Accept the selected suggestion: write only the missing suffix to the PTY. */
  const accept = useCallback(async () => {
    const { suggestions, selectedIndex, visible, requestId } = stateRef.current;
    if (!visible || suggestions.length === 0) return;

    const fullCmd = suggestions[selectedIndex] ?? suggestions[0];
    const current = inputBufferRef.current;
    const suffix = computeSuffix(current, fullCmd);

    if (requestId) cancelRequest(requestId);
    clearAiTimer();
    clearLocalTimer();

    if (suffix) {
      try {
        await terminalService.write(terminalId, suffix);
      } catch (err) {
        console.error('Failed to accept autocomplete suggestion:', err);
        return;
      }
    }
    inputBufferRef.current = fullCmd;

    setState((s) => ({
      ...s,
      suggestions: [],
      selectedIndex: 0,
      visible: false,
      loading: false,
      requestId: null,
      currentInput: fullCmd,
    }));
  }, [terminalId, cancelRequest, clearAiTimer, clearLocalTimer]);

  const selectNext = useCallback(() => {
    setState((s) => {
      if (!s.visible || s.suggestions.length <= 1) return s;
      return { ...s, selectedIndex: (s.selectedIndex + 1) % s.suggestions.length };
    });
  }, []);

  const selectPrev = useCallback(() => {
    setState((s) => {
      if (!s.visible || s.suggestions.length <= 1) return s;
      return {
        ...s,
        selectedIndex: (s.selectedIndex - 1 + s.suggestions.length) % s.suggestions.length,
      };
    });
  }, []);

  const requestFromAI = useCallback(
    async (buffer: string) => {
      if (!useAppStore.getState().terminalAutocompleteEnabled) return;
      if (!useAppStore.getState().autocompleteEnabled) return;
      if (remoteSessionRef.current) return;

      const prevId = stateRef.current.requestId;
      if (prevId) cancelRequest(prevId);

      const requestId = crypto.randomUUID();
      setState((s) => ({
        ...s,
        loading: true,
        requestId,
      }));

      try {
        await aiService.autocomplete({
          terminalId,
          partialCmd: buffer,
          requestId,
        });
      } catch (err) {
        console.error('Autocomplete request failed:', err);
        setState((s) => (s.requestId === requestId ? { ...s, loading: false, requestId: null } : s));
      }
    },
    [terminalId, cancelRequest]
  );

  const scheduleAiEnhancement = useCallback(
    (buffer: string, localCount: number) => {
      clearAiTimer();
      if (remoteSessionRef.current) return;
      if (!shouldAskAI(buffer, localCount)) return;

      aiDebounceTimerRef.current = setTimeout(() => {
        if (inputBufferRef.current === buffer) {
          void requestFromAI(buffer);
        }
      }, AI_DEBOUNCE_MS);
    },
    [clearAiTimer, requestFromAI]
  );

  const showSuggestions = useCallback((buffer: string, suggestions: string[]) => {
    const cursor = computePredictedCursor(terminalId, inputStartRef.current, buffer);
    const list = normalizeSuggestions(buffer, suggestions);

    setState((s) => ({
      ...s,
      suggestions: list,
      selectedIndex: Math.min(s.selectedIndex, Math.max(0, list.length - 1)),
      visible: list.length > 0,
      currentInput: buffer,
      cursorX: cursor?.x ?? null,
      cursorY: cursor?.y ?? null,
    }));

    return list.length;
  }, [terminalId]);

  const requestLocalSuggestions = useCallback(
    async (buffer: string, immediate: string[]) => {
      const seq = ++localSeqRef.current;
      if (remoteSessionRef.current) {
        const merged = mergeSuggestionLists(
          buffer,
          commandHistorySuggestions(buffer, remoteCommandHistoryRef.current),
          remoteCommandSuggestions(buffer)
        );
        const count = showSuggestions(buffer, merged);
        scheduleAiEnhancement(buffer, count);
        return;
      }

      try {
        const local = await terminalService.localCompletions({
          terminalId,
          partialCmd: buffer,
          limit: MAX_VISIBLE_ITEMS,
        });
        if (seq !== localSeqRef.current || inputBufferRef.current !== buffer) return;

        const merged = mergeSuggestionLists(
          buffer,
          immediate,
          commandHistorySuggestions(buffer, commandHistoryRef.current),
          local.map((item) => item.text),
          cachedAiSuggestionsRef.current
        );
        const count = showSuggestions(buffer, merged);
        scheduleAiEnhancement(buffer, count);
      } catch (err) {
        console.error('Local autocomplete failed:', err);
        if (seq === localSeqRef.current && inputBufferRef.current === buffer) {
          scheduleAiEnhancement(buffer, immediate.length);
        }
      }
    },
    [terminalId, showSuggestions, scheduleAiEnhancement]
  );

  /** Process incoming keystroke data from xterm's onData (READ-ONLY). */
  const handleInput = useCallback(
    (data: string) => {
      clearAiTimer();
      clearLocalTimer();

      if (terminalRegistry.isSensitiveInputPrompt(terminalId)) {
        inputBufferRef.current = '';
        inputStartRef.current = null;
        cachedAiSuggestionsRef.current = [];
        localSeqRef.current += 1;
        if (stateRef.current.requestId) cancelRequest(stateRef.current.requestId);
        setState((s) => ({
          ...s,
          suggestions: [],
          selectedIndex: 0,
          visible: false,
          loading: false,
          requestId: null,
          currentInput: '',
          cursorX: null,
          cursorY: null,
        }));
        return;
      }

      let buffer = inputBufferRef.current;
      let resetBuffer = false;
      let start = inputStartRef.current;

      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (code === 0x04) {
          if (remoteSessionRef.current) {
            remoteSessionRef.current = false;
            cachedAiSuggestionsRef.current = [];
            localSeqRef.current += 1;
          }
          resetBuffer = true;
          break;
        }
        if (ch === '\r' || ch === '\n' || code === 0x03) {
          const command = buffer.trim();
          if (ch === '\r' || ch === '\n') {
            if (remoteSessionRef.current) {
              rememberExecutedCommand(remoteCommandHistoryRef.current, buffer);
              if (isRemoteExitCommand(command)) {
                remoteSessionRef.current = false;
                cachedAiSuggestionsRef.current = [];
              }
            } else {
              rememberExecutedCommand(commandHistoryRef.current, buffer);
              if (isSshCommand(command)) {
                remoteSessionRef.current = true;
                cachedAiSuggestionsRef.current = [];
              }
            }
          }
          resetBuffer = true;
          break;
        }
        if (code === 0x15) {
          buffer = '';
          start = null;
          continue;
        }
        if (code === 0x17) {
          buffer = buffer.replace(/\s+\S*\s*$/, '').replace(/\S+$/, '');
          if (buffer.length === 0) start = null;
          continue;
        }
        if (code === 0x7f || code === 0x08) {
          buffer = Array.from(buffer).slice(0, -1).join('');
          if (buffer.length === 0) start = null;
          continue;
        }
        if (code === 0x1b) {
          buffer = '';
          start = null;
          resetBuffer = true;
          break;
        }
        if (code === 0x09) continue;
        if ((code >= 0x20 && code <= 0x7e) || code >= 0x80) {
          if (!start && buffer.length === 0) {
            start = readCursorCell(terminalId);
          }
          buffer += ch;
        }
      }

      if (resetBuffer) {
        inputBufferRef.current = '';
        inputStartRef.current = null;
        cachedAiSuggestionsRef.current = [];
        localSeqRef.current += 1;
        if (stateRef.current.requestId) cancelRequest(stateRef.current.requestId);
        setState((s) => ({
          ...s,
          suggestions: [],
          selectedIndex: 0,
          visible: false,
          loading: false,
          requestId: null,
          currentInput: '',
          cursorX: null,
          cursorY: null,
        }));
        return;
      }

      inputBufferRef.current = buffer;
      inputStartRef.current = start;

      if (buffer.length === 0) {
        localSeqRef.current += 1;
        cachedAiSuggestionsRef.current = [];
        if (stateRef.current.requestId) cancelRequest(stateRef.current.requestId);
        setState((s) => ({
          ...s,
          suggestions: [],
          selectedIndex: 0,
          visible: false,
          loading: false,
          requestId: null,
          currentInput: '',
          cursorX: null,
          cursorY: null,
        }));
        return;
      }

      if (!useAppStore.getState().terminalAutocompleteEnabled) {
        localSeqRef.current += 1;
        clearAiTimer();
        clearLocalTimer();
        if (stateRef.current.requestId) cancelRequest(stateRef.current.requestId);
        setState((s) => ({
          ...s,
          suggestions: [],
          selectedIndex: 0,
          visible: false,
          loading: false,
          requestId: null,
          currentInput: buffer,
          cursorX: null,
          cursorY: null,
        }));
        return;
      }

      const cursor = computePredictedCursor(terminalId, start, buffer);
      setState((s) => ({
        ...s,
        currentInput: buffer,
        cursorX: cursor?.x ?? null,
        cursorY: cursor?.y ?? null,
      }));

      if (buffer.trim().length < MIN_LOCAL_INPUT_LENGTH) return;

      const remoteContext = remoteSessionRef.current;
      const immediate = mergeSuggestionLists(
        buffer,
        remoteContext ? [] : stateRef.current.suggestions,
        customCompletionSuggestions(buffer),
        commandHistorySuggestions(
          buffer,
          remoteSessionRef.current ? remoteCommandHistoryRef.current : commandHistoryRef.current
        ),
        remoteContext ? remoteCommandSuggestions(buffer) : [],
        remoteContext ? [] : cachedAiSuggestionsRef.current
      );
      const immediateCount = showSuggestions(buffer, immediate);
      localDebounceTimerRef.current = setTimeout(() => {
        if (inputBufferRef.current === buffer) {
          void requestLocalSuggestions(buffer, immediate);
        }
      }, LOCAL_DEBOUNCE_MS);
      if (immediateCount > 0) {
        scheduleAiEnhancement(buffer, immediateCount);
      }
    },
    [
      terminalId,
      cancelRequest,
      clearAiTimer,
      clearLocalTimer,
      requestLocalSuggestions,
      scheduleAiEnhancement,
      showSuggestions,
    ]
  );

  // Listen for the single non-streaming AI result event.
  useEffect(() => {
    return onTerminalAutocompleteDismiss(dismiss);
  }, [dismiss]);

  useEffect(() => {
    let cancelled = false;
    const setupListener = async () => {
      try {
        const unlisten = await listen<AutocompleteResultPayload>(
          'ai-autocomplete-result',
          (event) => {
            const { requestId, terminalId: eventTermId, suggestions, error } = event.payload;
            if (eventTermId !== terminalId) return;
            if (requestId !== stateRef.current.requestId) return;

            const current = inputBufferRef.current;
            if (current.trim().length === 0 || error) {
              setState((s) => ({
                ...s,
                loading: false,
                requestId: null,
                visible: s.suggestions.length > 0,
              }));
              return;
            }

            const aiList = normalizeSuggestions(current, suggestions ?? []);
            cachedAiSuggestionsRef.current = aiList;

            const merged = mergeSuggestionLists(current, stateRef.current.suggestions, aiList);
            const cursor = computePredictedCursor(terminalId, inputStartRef.current, current);
            setState((s) => ({
              ...s,
              loading: false,
              requestId: null,
              suggestions: merged,
              selectedIndex: 0,
              visible: merged.length > 0,
              currentInput: current,
              cursorX: cursor?.x ?? null,
              cursorY: cursor?.y ?? null,
            }));
          }
        );

        if (cancelled) {
          unlisten();
          return;
        }
        unlistenersRef.current = [unlisten];
      } catch (err) {
        if (!cancelled) console.error('Autocomplete listener setup failed:', err);
      }
    };

    void setupListener();

    return () => {
      cancelled = true;
      unlistenersRef.current.forEach((un) => un());
      unlistenersRef.current = [];
      clearAiTimer();
      clearLocalTimer();
      if (stateRef.current.requestId) cancelRequest(stateRef.current.requestId);
    };
  }, [terminalId, cancelRequest, clearAiTimer, clearLocalTimer]);

  return {
    state,
    handleInput,
    accept,
    dismiss,
    selectNext,
    selectPrev,
  };
}

/**
 * Global user-curated completions (Settings → 自定义补全管理). Applied in both
 * local and remote sessions since the user explicitly defined them; dedup vs
 * other sources happens in `mergeSuggestionLists`.
 */
function customCompletionSuggestions(buffer: string): string[] {
  return useAppStore
    .getState()
    .customCompletions
    .map((command) => command.command.trimEnd())
    .filter((command) => isPrefixCompletion(buffer, command) && command.length > buffer.length);
}

function remoteCommandSuggestions(buffer: string): string[] {
  return REMOTE_COMMON_COMMANDS.filter(
    (command) => isPrefixCompletion(buffer, command) && command.length > buffer.length
  );
}

function commandHistorySuggestions(buffer: string, history: string[]): string[] {
  return history.filter((command) => isPrefixCompletion(buffer, command) && command.length > buffer.length);
}

function rememberExecutedCommand(history: string[], raw: string) {
  const command = raw.trim();
  if (!command || command.startsWith('#')) return;

  const existing = history.findIndex((item) => item === command);
  if (existing >= 0) {
    history.splice(existing, 1);
  }
  history.unshift(command);

  if (history.length > MAX_COMMAND_HISTORY) {
    history.length = MAX_COMMAND_HISTORY;
  }
}

function isSshCommand(command: string): boolean {
  return /(?:^|\s)ssh(?:\s|$)/.test(command.trim());
}

function isRemoteExitCommand(command: string): boolean {
  return /^(exit|logout)(?:\s|$)/.test(command.trim());
}

function shouldAskAI(buffer: string, localCount: number): boolean {
  const trimmed = buffer.trim();
  if (trimmed.length < MIN_AI_INPUT_LENGTH) return false;
  if (!useAppStore.getState().terminalAutocompleteEnabled) return false;
  if (!useAppStore.getState().autocompleteEnabled) return false;

  const hasArguments = /\s/.test(trimmed);
  const hasShellOperator = /[|;&><`$(){}[\]*?]/.test(trimmed);
  return localCount === 0 || hasArguments || hasShellOperator;
}

function normalizeSuggestions(current: string, suggestions: string[]): string[] {
  return mergeSuggestionLists(current, suggestions);
}

function mergeSuggestionLists(current: string, ...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const list of lists) {
    for (const raw of list) {
      const suggestion = raw.trimEnd();
      if (!isPrefixCompletion(current, suggestion) || suggestion.length <= current.length) {
        continue;
      }
      if (seen.has(suggestion)) continue;
      seen.add(suggestion);
      out.push(suggestion);
      if (out.length >= MAX_VISIBLE_ITEMS) return out;
    }
  }

  return out;
}

function readCursorCell(terminalId: string): CursorCell | null {
  const term = terminalRegistry.getTerminal(terminalId);
  if (!term) return null;
  const buffer = term.buffer.active;
  return { x: buffer.cursorX, y: buffer.cursorY };
}

function computePredictedCursor(
  terminalId: string,
  start: CursorCell | null,
  input: string
): CursorCell | null {
  const term = terminalRegistry.getTerminal(terminalId);
  if (!term) return null;

  if (!start) {
    const buffer = term.buffer.active;
    return { x: buffer.cursorX, y: buffer.cursorY };
  }

  const cols = Math.max(1, term.cols);
  const rows = Math.max(1, term.rows);
  const columns = stringCellWidth(input);
  const absolute = start.x + columns;
  return {
    x: absolute % cols,
    y: Math.min(rows - 1, start.y + Math.floor(absolute / cols)),
  };
}

function stringCellWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += isWideCodePoint(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWideCodePoint(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function isPrefixCompletion(current: string, full: string): boolean {
  return full.startsWith(current) || full.toLowerCase().startsWith(current.toLowerCase());
}

/**
 * Compute the suffix to append so that `current + suffix == full`.
 * Returns an empty suffix for non-prefix matches; those are intentionally not
 * accepted inline because appending a whole unrelated command corrupts input.
 */
function computeSuffix(current: string, full: string): string {
  if (full.startsWith(current)) {
    return full.slice(current.length);
  }
  if (full.toLowerCase().startsWith(current.toLowerCase())) {
    return full.slice(current.length);
  }
  return '';
}
