import { Server } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { SshShortcut } from '@/types';

/**
 * Bottom section of the left panel: a read-only list of saved SSH shortcuts.
 * CRUD lives in Settings → SSH; here you can only click a row to connect.
 */
export function SshShortcuts() {
  const shortcuts = useAppStore((s) => s.sshShortcuts);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 12px',
          height: 28,
          flexShrink: 0,
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
          SSH{shortcuts.length > 0 ? ` (${shortcuts.length})` : ''}
        </span>
      </div>

      <div style={{ overflowY: 'auto', paddingBottom: 4 }}>
        {shortcuts.length === 0 ? (
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              color: 'var(--color-text-muted)',
            }}
          >
            No SSH shortcuts.
          </div>
        ) : (
          shortcuts.map((s) => <SshRow key={s.id} shortcut={s} />)
        )}
      </div>
    </div>
  );
}

function SshRow({ shortcut }: { shortcut: SshShortcut }) {
  const openSshShortcut = useAppStore((s) => s.openSshShortcut);

  const hostLabel = `${shortcut.user}@${shortcut.host}${shortcut.port !== 22 ? `:${shortcut.port}` : ''}`;

  return (
    <div
      className="ssh-item"
      onClick={() => void openSshShortcut(shortcut)}
      title={`Connect to ${hostLabel}`}
    >
      <span style={{ display: 'inline-flex', color: 'var(--color-accent)', flexShrink: 0 }}>
        <Server size={14} strokeWidth={1.75} />
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
          lineHeight: 1.3,
        }}
      >
        <span
          className="truncate"
          style={{ fontSize: 13, color: 'var(--color-text-primary)' }}
        >
          {shortcut.name}
        </span>
        <span
          className="truncate"
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
          }}
          title={hostLabel}
        >
          {hostLabel}
        </span>
      </span>
    </div>
  );
}
