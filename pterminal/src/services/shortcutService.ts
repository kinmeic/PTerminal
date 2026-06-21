/**
 * Keyboard shortcut configuration system.
 * Defines all customizable shortcuts with their default bindings and validation.
 */

/** Modifier keys that can be combined. */
export type Modifier = 'cmd' | 'shift' | 'alt' | 'ctrl';

/** A keyboard shortcut binding. */
export interface ShortcutBinding {
  /** Primary key (e.g. 'b', 't', '1', 'Enter'). */
  key: string;
  /** Modifier keys required. */
  modifiers: Modifier[];
}

/** A configurable shortcut definition. */
export interface ShortcutDef {
  id: string;
  /** Human-readable description key (for i18n). */
  descriptionKey: string;
  /** Default binding when no custom config exists. */
  defaultBinding: ShortcutBinding;
  /** Current binding (may be overridden by user). */
  binding: ShortcutBinding;
  /** Whether this shortcut can be customized. */
  editable: boolean;
  /** Category for grouping in settings. */
  category: 'navigation' | 'terminal' | 'panel' | 'ai';
}

/** All available shortcuts in the application. */
export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Navigation
  {
    id: 'newTerminal',
    descriptionKey: 'shortcuts.newTerminal',
    defaultBinding: { key: 'n', modifiers: ['cmd'] },
    binding: { key: 'n', modifiers: ['cmd'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'closeTerminal',
    descriptionKey: 'shortcuts.closeTerminal',
    defaultBinding: { key: 'w', modifiers: ['cmd'] },
    binding: { key: 'w', modifiers: ['cmd'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'nextTerminal',
    descriptionKey: 'shortcuts.nextTerminal',
    defaultBinding: { key: ']', modifiers: ['cmd', 'shift'] },
    binding: { key: ']', modifiers: ['cmd', 'shift'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'prevTerminal',
    descriptionKey: 'shortcuts.prevTerminal',
    defaultBinding: { key: '[', modifiers: ['cmd', 'shift'] },
    binding: { key: '[', modifiers: ['cmd', 'shift'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'focusTerminal1',
    descriptionKey: 'shortcuts.focusTerminal1',
    defaultBinding: { key: '1', modifiers: ['cmd'] },
    binding: { key: '1', modifiers: ['cmd'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'focusTerminal2',
    descriptionKey: 'shortcuts.focusTerminal2',
    defaultBinding: { key: '2', modifiers: ['cmd'] },
    binding: { key: '2', modifiers: ['cmd'] },
    editable: true,
    category: 'navigation',
  },
  {
    id: 'focusTerminal3',
    descriptionKey: 'shortcuts.focusTerminal3',
    defaultBinding: { key: '3', modifiers: ['cmd'] },
    binding: { key: '3', modifiers: ['cmd'] },
    editable: true,
    category: 'navigation',
  },

  // Terminal
  {
    id: 'zoomIn',
    descriptionKey: 'shortcuts.zoomIn',
    defaultBinding: { key: '=', modifiers: ['cmd'] },
    binding: { key: '=', modifiers: ['cmd'] },
    editable: true,
    category: 'terminal',
  },
  {
    id: 'zoomOut',
    descriptionKey: 'shortcuts.zoomOut',
    defaultBinding: { key: '-', modifiers: ['cmd'] },
    binding: { key: '-', modifiers: ['cmd'] },
    editable: true,
    category: 'terminal',
  },
  {
    id: 'zoomReset',
    descriptionKey: 'shortcuts.zoomReset',
    defaultBinding: { key: '0', modifiers: ['cmd'] },
    binding: { key: '0', modifiers: ['cmd'] },
    editable: true,
    category: 'terminal',
  },
  {
    id: 'toggleSearch',
    descriptionKey: 'shortcuts.toggleSearch',
    defaultBinding: { key: 'f', modifiers: ['cmd'] },
    binding: { key: 'f', modifiers: ['cmd'] },
    editable: true,
    category: 'terminal',
  },

  // Panel
  {
    id: 'toggleLeftPanel',
    descriptionKey: 'shortcuts.toggleLeftPanel',
    defaultBinding: { key: 'b', modifiers: ['cmd'] },
    binding: { key: 'b', modifiers: ['cmd'] },
    editable: true,
    category: 'panel',
  },
  {
    id: 'toggleRightPanel',
    descriptionKey: 'shortcuts.toggleRightPanel',
    defaultBinding: { key: 'p', modifiers: ['cmd', 'shift'] },
    binding: { key: 'p', modifiers: ['cmd', 'shift'] },
    editable: true,
    category: 'panel',
  },
  {
    id: 'toggleTheme',
    descriptionKey: 'shortcuts.toggleTheme',
    defaultBinding: { key: 'l', modifiers: ['cmd', 'shift'] },
    binding: { key: 'l', modifiers: ['cmd', 'shift'] },
    editable: true,
    category: 'panel',
  },
];

/** Storage key for custom shortcuts. */
export const SHORTCUTS_STORAGE_KEY = 'keyboard_shortcuts';

/**
 * Notify listeners (e.g. the global keydown hook in the same document)
 * that the stored shortcuts changed. The `storage` event only fires in
 * OTHER documents/tabs, so we dispatch a custom event here for same-window
 * consumers.
 */
function notifyShortcutsChanged(): void {
  window.dispatchEvent(new Event('shortcuts-changed'));
}

/** Load shortcuts from storage, merging with defaults. */
export function loadShortcuts(): ShortcutDef[] {
  try {
    const saved = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (!saved) return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));

    const overrides: Record<string, ShortcutBinding> = JSON.parse(saved);
    return DEFAULT_SHORTCUTS.map((def) => ({
      ...def,
      binding: overrides[def.id] ?? { ...def.defaultBinding },
    }));
  } catch {
    return DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
  }
}

/** Save custom shortcut overrides to storage. */
export function saveShortcuts(shortcuts: ShortcutDef[]): void {
  const overrides: Record<string, ShortcutBinding> = {};
  for (const s of shortcuts) {
    // Only save if different from default
    if (
      s.binding.key !== s.defaultBinding.key ||
      s.binding.modifiers.length !== s.defaultBinding.modifiers.length ||
      !s.binding.modifiers.every((m) => s.defaultBinding.modifiers.includes(m))
    ) {
      overrides[s.id] = s.binding;
    }
  }
  localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(overrides));
  notifyShortcutsChanged();
}

/** Reset all shortcuts to defaults. */
export function resetShortcuts(): ShortcutDef[] {
  localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
  notifyShortcutsChanged();
  return DEFAULT_SHORTCUTS.map((s) => ({ ...s, binding: { ...s.defaultBinding } }));
}

/** Format a shortcut binding as a human-readable string (macOS style). */
export function formatShortcut(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.modifiers.includes('cmd')) parts.push('⌘');
  if (binding.modifiers.includes('shift')) parts.push('⇧');
  if (binding.modifiers.includes('alt')) parts.push('⌥');
  if (binding.modifiers.includes('ctrl')) parts.push('⌃');
  parts.push(binding.key.toUpperCase());
  return parts.join('');
}

/** Check if a keyboard event matches a shortcut binding. */
export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) return false;

  const hasCmd = binding.modifiers.includes('cmd');
  const hasShift = binding.modifiers.includes('shift');
  const hasAlt = binding.modifiers.includes('alt');
  const hasCtrl = binding.modifiers.includes('ctrl');

  if (hasCmd !== (event.metaKey || event.ctrlKey)) return false;
  if (hasShift !== event.shiftKey) return false;
  if (hasAlt !== event.altKey) return false;
  // On macOS, metaKey is Cmd; on Windows/Linux, ctrlKey is used.
  // We treat either as satisfying the 'cmd' modifier requirement.
  if (hasCtrl && !event.ctrlKey && !event.metaKey) return false;

  return true;
}

/** Validate a new shortcut binding (check for conflicts). */
export function validateShortcut(
  shortcuts: ShortcutDef[],
  shortcutId: string,
  newBinding: ShortcutBinding
): { valid: boolean; conflict?: string } {
  // Check for conflicts with other shortcuts
  for (const s of shortcuts) {
    if (s.id === shortcutId) continue;
    if (
      s.binding.key.toLowerCase() === newBinding.key.toLowerCase() &&
      s.binding.modifiers.length === newBinding.modifiers.length &&
      s.binding.modifiers.every((m) => newBinding.modifiers.includes(m))
    ) {
      return { valid: false, conflict: s.id };
    }
  }
  return { valid: true };
}

/** Get a shortcut by ID. */
export function getShortcutById(shortcuts: ShortcutDef[], id: string): ShortcutDef | undefined {
  return shortcuts.find((s) => s.id === id);
}

/** Update a shortcut binding. */
export function updateShortcutBinding(
  shortcuts: ShortcutDef[],
  id: string,
  binding: ShortcutBinding
): ShortcutDef[] {
  return shortcuts.map((s) => (s.id === id ? { ...s, binding: { ...binding } } : s));
}
