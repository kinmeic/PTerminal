import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { CommonCommands } from '@/components/commands/CommonCommands';
import { AIChatPanel } from '@/components/ai/AIChatPanel';

type Tab = 'commands' | 'ai';

export function RightPanel() {
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const loadCommands = useAppStore((s) => s.loadCommands);
  const loadAiConfig = useAppStore((s) => s.loadAiConfig);
  const [tab, setTab] = useState<Tab>('commands');

  // Load terminal-scoped data whenever the active terminal changes.
  useEffect(() => {
    if (activeTerminalId) {
      void loadCommands(activeTerminalId);
    }
  }, [activeTerminalId, loadCommands]);

  // Load AI config once on mount.
  useEffect(() => {
    void loadAiConfig();
  }, [loadAiConfig]);

  return (
    <div className="panel h-full">
      {/* Tabbed header */}
      <div className="panel-header" style={{ padding: 0, gap: 0 }}>
        <div style={{ display: 'flex', flex: 1, height: '100%' }}>
          <TabButton
            label="命令"
            active={tab === 'commands'}
            onClick={() => setTab('commands')}
          />
          <TabButton
            label="AI 助手"
            active={tab === 'ai'}
            onClick={() => setTab('ai')}
          />
        </div>
      </div>

      {activeTerminalId ? (
        tab === 'ai' ? (
          // AI chat fills the full panel height (its own internal scrolling).
          <div className="flex-1 min-h-0">
            <AIChatPanel />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <CommonCommands />
            </div>
          </div>
        )
      ) : (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            height: '100%',
          }}
        >
          <img
            src="/logo.png"
            alt="PTerminal"
            style={{ width: 96, height: 96, opacity: 0.9, borderRadius: 20 }}
          />
          <span>Select a terminal to view its commands.</span>
        </div>
      )}
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        height: '100%',
        padding: '0 12px',
        border: 'none',
        background: 'transparent',
        color: active
          ? 'var(--color-accent)'
          : 'var(--color-text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        cursor: 'pointer',
        borderBottom: active
          ? '2px solid var(--color-accent)'
          : '2px solid transparent',
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  );
}
