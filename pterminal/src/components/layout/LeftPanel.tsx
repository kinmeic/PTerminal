import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Circle,
  X,
  Settings,
  Pin,
  PinOff,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { SshShortcuts } from '@/components/ssh/SshShortcuts';
import { dismissTerminalAutocomplete } from '@/services/autocompleteEvents';
import type { Terminal } from '@/types';

/**
 * Left sidebar. Split vertically into three regions:
 *   - top (flex-1): the terminal list, independently scrollable.
 *   - middle (shrink-0): SSH shortcuts, also independently scrollable.
 *   - bottom (shrink-0): the settings entry, always pinned to the bottom.
 */
export function LeftPanel() {
  const terminals = useAppStore((s) => s.terminals);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const setActiveTerminal = useAppStore((s) => s.setActiveTerminal);
  const createTerminal = useAppStore((s) => s.createTerminal);
  const deleteTerminal = useAppStore((s) => s.deleteTerminal);
  const setActiveView = useAppStore((s) => s.setActiveView);

  // Right-click context menu state.
  const [menu, setMenu] = useState<{ x: number; y: number; terminal: Terminal } | null>(null);
  // Inline rename state (set via the context menu's "重命名").
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Close the context menu on Escape / window resize. Outside clicks are
  // handled by a dedicated backdrop layer (see TerminalContextMenu) rather
  // than a window-level click listener, so clicks on menu items always fire
  // their handlers before the menu is torn down.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('resize', setMenuNull);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', setMenuNull);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function setMenuNull() {
    setMenu(null);
  }

  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="panel-header justify-between">
        <span>Terminals</span>
          <button
            className="collapse-button"
            title="New Terminal"
            onClick={() => {
              dismissTerminalAutocomplete();
              void createTerminal();
            }}
          >
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </div>

      {/* Top region — terminal list (takes remaining height, scrolls) */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {terminals.length === 0 ? (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 12,
            }}
          >
            No terminals yet.
            <br />
            Click + to create one.
          </div>
        ) : (
          terminals.map((t) => (
            <TerminalRow
              key={t.id}
              terminal={t}
              active={activeTerminalId === t.id}
              renaming={renamingId === t.id}
              onSelect={() => setActiveTerminal(t.id)}
              onDelete={() => void deleteTerminal(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, terminal: t });
              }}
              onRenameDone={() => setRenamingId(null)}
            />
          ))
        )}
      </div>

      {/* Middle region — SSH shortcuts (shrink-0, internally scrollable) */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--color-border)',
          maxHeight: '40vh',
          overflowY: 'auto',
        }}
      >
        <SshShortcuts />
      </div>

      {/* Bottom region — settings entry (always pinned to bottom) */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--color-border)',
          padding: '6px 8px',
        }}
      >
        <button
          onClick={() => setActiveView('settings')}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Settings size={15} strokeWidth={1.75} />
          <span>设置</span>
        </button>
      </div>

      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          terminal={menu.terminal}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenamingId(menu.terminal.id);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function TerminalRow({
  terminal,
  active,
  renaming,
  onSelect,
  onDelete,
  onContextMenu,
  onRenameDone,
}: {
  terminal: Terminal;
  active: boolean;
  renaming: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameDone: () => void;
}) {
  const renameTerminal = useAppStore((s) => s.renameTerminal);
  const [draft, setDraft] = useState(terminal.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync the draft when entering rename mode.
  useEffect(() => {
    if (renaming) {
      setDraft(terminal.name);
      // Focus on next paint.
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [renaming, terminal.name]);

  const commitRename = () => {
    const next = draft.trim();
    if (next && next !== terminal.name) {
      void renameTerminal(terminal.id, next);
    }
    onRenameDone();
  };

  return (
    <div
      className={`terminal-item group ${active ? 'active' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {terminal.isPinned ? (
        <span
          style={{ display: 'inline-flex', color: 'var(--color-accent)', flexShrink: 0 }}
          title="Pinned"
        >
          <Pin size={11} strokeWidth={2} fill="currentColor" />
        </span>
      ) : (
        <span style={{ display: 'inline-flex', color: 'var(--color-success)', flexShrink: 0 }}>
          <Circle size={9} strokeWidth={0} fill="currentColor" />
        </span>
      )}

      {renaming ? (
        <input
          ref={inputRef}
          className="terminal-rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onRenameDone();
            }
          }}
        />
      ) : (
        <span className="truncate flex-1" title={terminal.cwd}>
          {terminal.name}
        </span>
      )}

      {!renaming && (
        <button
          className="btn-icon opacity-0 group-hover:opacity-100"
          title="Delete terminal"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            padding: 2,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

/** Fixed-position dropdown menu shown on right-click over a terminal row. */
function TerminalContextMenu({
  x,
  y,
  terminal,
  onClose,
  onRename,
}: {
  x: number;
  y: number;
  terminal: Terminal;
  onClose: () => void;
  onRename: () => void;
}) {
  const togglePinTerminal = useAppStore((s) => s.togglePinTerminal);
  const deleteTerminal = useAppStore((s) => s.deleteTerminal);
  const ref = useRef<HTMLDivElement>(null);

  // Clamp position so the menu never overflows the viewport.
  const style: React.CSSProperties = { left: x, top: y };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    el.style.left = `${Math.min(x, maxX)}px`;
    el.style.top = `${Math.min(y, maxY)}px`;
  }, [x, y]);

  const handlePin = () => {
    void togglePinTerminal(terminal);
    onClose();
  };
  const handleDelete = () => {
    void deleteTerminal(terminal.id);
    onClose();
  };

  return (
    <>
      {/* Transparent backdrop captures outside clicks / right-clicks to close
          the menu. It sits below the menu (z-index 1999 < 2000) so clicks on
          menu items themselves never hit it. */}
      <div
        className="context-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div ref={ref} className="context-menu" style={style}>
        <button className="context-menu-item" onClick={handlePin}>
          {terminal.isPinned ? (
            <>
              <PinOff size={14} strokeWidth={1.75} />
              取消置顶
            </>
          ) : (
            <>
              <Pin size={14} strokeWidth={1.75} />
              置顶
            </>
          )}
        </button>
        <button className="context-menu-item" onClick={onRename}>
          <Pencil size={14} strokeWidth={1.75} />
          重命名
        </button>
        <div className="context-menu-divider" />
        <button className="context-menu-item danger" onClick={handleDelete}>
          <Trash2 size={14} strokeWidth={1.75} />
          删除
        </button>
      </div>
    </>
  );
}
