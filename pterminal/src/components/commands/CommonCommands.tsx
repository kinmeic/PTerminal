import { useState } from 'react';
import { Plus, Star, Play, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useI18n } from '@/i18n/I18nProvider';
import { CommandForm } from './CommandForm';
import type { Command } from '@/types';

/**
 * Common (saved) commands panel for the active terminal. Supports add, edit,
 * pin/unpin, delete, and run (single click inserts, double-click runs).
 */
export function CommonCommands() {
  const commands = useAppStore((s) => s.commonCommands);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const sendCommand = useAppStore((s) => s.sendCommand);
  const removeCommand = useAppStore((s) => s.removeCommand);
  const togglePinCommand = useAppStore((s) => s.togglePinCommand);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Command | null>(null);
  const { t } = useI18n();

  if (!activeTerminalId) {
    return <EmptyHint text={t('commands.selectTerminal')} />;
  }

  const sorted = [...commands].sort(compareCommands);
  const pinned = sorted.filter((c) => c.isPinned);
  const unpinned = sorted.filter((c) => !c.isPinned);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('commands.title')}{commands.length > 0 ? ` (${commands.length})` : ''}
        </span>
        <button
          className="btn-icon"
          title={t('commands.add')}
          onClick={() => {
            setEditing(null);
            setShowForm((v) => !v);
          }}
          style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </div>

      {showForm && !editing && (
        <div style={{ marginBottom: 8 }}>
          <CommandForm onClose={() => setShowForm(false)} />
        </div>
      )}

      {commands.length === 0 && !showForm ? (
        <EmptyHint text={t('commands.empty')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pinned.length > 0 && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                margin: '4px 0 2px',
              }}
              >
              {t('common.pinned')}
            </div>
          )}
          {pinned.map((c) => (
            <CommandRow
              key={c.id}
              command={c}
              onRun={() => void sendCommand(activeTerminalId, c.command)}
              onEdit={() => {
                setEditing(c);
                setShowForm(false);
              }}
              onTogglePin={() => void togglePinCommand(c)}
              onDelete={() => void removeCommand(c.id)}
            />
          ))}
          {pinned.length > 0 && unpinned.length > 0 && (
            <div
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                margin: '6px 0 2px',
              }}
              >
              {t('common.others')}
            </div>
          )}
          {unpinned.map((c) => (
            <CommandRow
              key={c.id}
              command={c}
              onRun={() => void sendCommand(activeTerminalId, c.command)}
              onEdit={() => {
                setEditing(c);
                setShowForm(false);
              }}
              onTogglePin={() => void togglePinCommand(c)}
              onDelete={() => void removeCommand(c.id)}
            />
          ))}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          <CommandForm
            editingId={editing.id}
            initialLabel={editing.label}
            initialCommand={editing.command}
            onClose={() => setEditing(null)}
          />
        </div>
      )}
    </div>
  );
}

function CommandRow({
  command,
  onRun,
  onEdit,
  onTogglePin,
  onDelete,
}: {
  command: Command;
  onRun: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="group"
      style={{
        padding: '5px 8px',
        borderRadius: 4,
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        cursor: 'pointer',
      }}
      title={t('commands.insertRunTooltip', { command: command.command })}
      onClick={() => onEdit()} // single click = edit inline (avoids accidental run)
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRun();
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 2,
        }}
      >
        <span
          style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {command.label}
        </span>
        <button
          className="btn-icon opacity-0 group-hover:opacity-100"
          title={command.isPinned ? t('commands.unpin') : t('commands.pinToTop')}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          style={{
            padding: 2,
            lineHeight: 1.2,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {command.isPinned ? <Star size={14} strokeWidth={1.75} fill="currentColor" /> : <Star size={14} strokeWidth={1.75} />}
        </button>
        <button
          className="btn-icon opacity-0 group-hover:opacity-100"
          title={t('commands.runNow')}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          style={{
            padding: 2,
            lineHeight: 1.2,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Play size={13} strokeWidth={1.75} fill="currentColor" />
        </button>
        <button
          className="btn-icon opacity-0 group-hover:opacity-100"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            padding: 2,
            lineHeight: 1.2,
            width: 22,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--color-terminal-green)', marginRight: 4 }}>$</span>
        {command.command}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: '8px 0' }}>
      {text}
    </div>
  );
}

function compareCommands(a: Command, b: Command): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  if (a.isPinned && b.isPinned && a.pinOrder !== b.pinOrder) {
    return a.pinOrder - b.pinOrder;
  }
  return a.createdAt - b.createdAt;
}
