import { Server } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useI18n } from '@/i18n/I18nProvider';
import { dismissTerminalAutocomplete } from '@/services/autocompleteEvents';
import type { SshShortcut } from '@/types';

/**
 * Bottom section of the left panel: a read-only list of saved SSH shortcuts.
 * CRUD lives in Settings → SSH; here you can only click a row to connect.
 */
export function SshShortcuts() {
  const shortcuts = useAppStore((s) => s.sshShortcuts);
  const { t } = useI18n();

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
          {t('ssh.title')}{shortcuts.length > 0 ? ` (${shortcuts.length})` : ''}
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
            {t('ssh.empty')}
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
  const { t } = useI18n();

  const hostLabel = `${shortcut.user}@${shortcut.host}${shortcut.port !== 22 ? `:${shortcut.port}` : ''}`;

  return (
    <div
      className="ssh-item"
      onClick={() => {
        dismissTerminalAutocomplete();
        void openSshShortcut(shortcut);
      }}
      title={t('ssh.connectTo', { host: hostLabel })}
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
