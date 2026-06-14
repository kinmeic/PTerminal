import { useToastStore, type ToastKind } from '@/stores/toastStore';

/** Fixed-position toast container rendered at the app root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 2000,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          style={{
            ...baseStyle,
            ...kindStyle(t.kind),
            cursor: 'pointer',
          }}
        >
          <span style={{ marginRight: 8 }}>{icon(t.kind)}</span>
          <span style={{ flex: 1 }}>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

const baseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--color-text-primary)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-bg-tertiary)',
};

function kindStyle(kind: ToastKind): React.CSSProperties {
  switch (kind) {
    case 'error':
      return { borderLeft: '3px solid var(--color-danger)' };
    case 'success':
      return { borderLeft: '3px solid var(--color-success)' };
    default:
      return { borderLeft: '3px solid var(--color-accent)' };
  }
}

function icon(kind: ToastKind): string {
  switch (kind) {
    case 'error':
      return '⚠';
    case 'success':
      return '✓';
    default:
      return 'ℹ';
  }
}
