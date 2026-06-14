import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';

interface CommandFormProps {
  /** When set, the form edits this command; otherwise it creates a new one. */
  editingId?: string;
  initialLabel?: string;
  initialCommand?: string;
  onClose: () => void;
}

/**
 * Inline form for creating or editing a common command. Bound to the active
 * terminal (terminal_id = activeTerminalId).
 */
export function CommandForm({
  editingId,
  initialLabel = '',
  initialCommand = '',
  onClose,
}: CommandFormProps) {
  const [label, setLabel] = useState(initialLabel);
  const [command, setCommand] = useState(initialCommand);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const addCommand = useAppStore((s) => s.addCommand);
  const editCommand = useAppStore((s) => s.editCommand);

  useEffect(() => {
    setLabel(initialLabel);
    setCommand(initialCommand);
  }, [initialLabel, initialCommand]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !command.trim() || !activeTerminalId) return;
    if (editingId) {
      await editCommand(editingId, { label: label.trim(), command: command.trim() });
    } else {
      await addCommand({
        terminalId: activeTerminalId,
        label: label.trim(),
        command: command.trim(),
      });
    }
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    borderRadius: 4,
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    fontSize: 12,
    outline: 'none',
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
      }}
    >
      <input
        type="text"
        placeholder="Label (e.g. List files)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        autoFocus
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Command (e.g. ls -la)"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {editingId ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}
