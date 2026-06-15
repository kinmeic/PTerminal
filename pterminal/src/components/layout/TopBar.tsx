import type { ReactNode } from 'react';
import { useRef } from 'react';
import { PanelLeft, PanelRight, Sun, Moon, ArrowLeft, ZoomIn, ZoomOut } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '@/stores/appStore';
import { DEFAULT_FONT_SIZE } from '@/stores/appStore';

interface TopBarProps {
  /** Optional leading control rendered right after the traffic-light gap
   *  (e.g. the left-drawer toggle in the terminal view). */
  leftSlot?: ReactNode;
  /** Center title (terminal name in terminal view, "设置" in settings). */
  title?: ReactNode;
  /** Optional subtitle shown after the title (terminal cwd). */
  subtitle?: ReactNode;
  /** Trailing controls on the right (drawer toggle, theme, back, …). */
  rightSlot?: ReactNode;
}

/**
 * Unified top bar that spans the whole window. It replaces the native title
 * bar (tauri.conf.json uses `titleBarStyle: "Overlay"`), so the macOS traffic
 * lights float over its left side — hence the 84px left padding reserved in
 * CSS. Grabbing the bar background starts a native window drag; buttons and
 * other interactive elements opt out via the `data-no-window-drag` attribute
 * so they still receive clicks.
 */
export function TopBar({ leftSlot, title, subtitle, rightSlot }: TopBarProps) {
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // only left button initiates a drag
    const target = e.target as HTMLElement | null;
    // Don't drag when the press lands on an interactive control.
    if (target?.closest('button, select, input, textarea, a, [data-no-window-drag]')) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  return (
    <div className="topbar" data-tauri-drag-region onMouseDown={handleMouseDown}>
      {/* Left: traffic-light gap + optional left drawer toggle + title */}
      <div
        data-tauri-drag-region
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          flex: 1,
          height: '100%',
        }}
      >
        {leftSlot}
        {title && <span className="topbar-title" data-tauri-drag-region>{title}</span>}
        {subtitle && <span className="topbar-subtitle" data-tauri-drag-region>· {subtitle}</span>}
      </div>

      {/* Right: trailing controls */}
      {rightSlot && (
        <div
          data-tauri-drag-region
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            height: '100%',
          }}
        >
          {rightSlot}
        </div>
      )}
    </div>
  );
}

/** Default left/right slots bound to the store, for the terminal view. */
export function TerminalTopBar() {
  const isLeftPanelVisible = useAppStore((s) => s.isLeftPanelVisible);
  const isRightPanelVisible = useAppStore((s) => s.isRightPanelVisible);
  const toggleLeftPanel = useAppStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);
  const setLeftPanelHovering = useAppStore((s) => s.setLeftPanelHovering);
  const isDarkMode = useAppStore((s) => s.isDarkMode);
  const toggleDarkMode = useAppStore((s) => s.toggleDarkMode);

  const defaultFontSize = useAppStore((s) => s.fontSize);
  const adjustTerminalFontSize = useAppStore((s) => s.adjustTerminalFontSize);

  /** Delay before hiding overlay when mouse leaves, so user can move to panel. */
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const terminals = useAppStore((s) => s.terminals);
  const activeTerminalId = useAppStore((s) => s.activeTerminalId);
  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);
  // Zoom reflects the active terminal's own size (or the global default).
  const activeFontSize = activeTerminal?.fontSize ?? defaultFontSize;
  const zoomPct = Math.round((activeFontSize / DEFAULT_FONT_SIZE) * 100);

  const handleLeftBtnEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (!isLeftPanelVisible) setLeftPanelHovering(true);
  };

  const handleLeftBtnLeave = () => {
    // Delay hiding so user can move mouse to the overlay panel
    hoverTimeoutRef.current = setTimeout(() => {
      setLeftPanelHovering(false);
    }, 300);
  };

  return (
    <TopBar
      leftSlot={
        <button
          className={`topbar-btn ${isLeftPanelVisible ? 'active' : ''}`}
          title={isLeftPanelVisible ? '隐藏侧边栏' : '显示侧边栏'}
          onClick={toggleLeftPanel}
          onMouseEnter={handleLeftBtnEnter}
          onMouseLeave={handleLeftBtnLeave}
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
      }
      title={activeTerminal ? activeTerminal.name : 'No Terminal Selected'}
      rightSlot={
        <>
          {/* Terminal zoom controls: shrink / percentage (click to reset) / grow */}
          <button
            className="topbar-btn"
            title="缩小终端字号"
            onClick={() => void adjustTerminalFontSize(-1)}
          >
            <ZoomOut size={15} strokeWidth={1.75} />
          </button>
          <button
            className="topbar-zoom-label"
            title={`缩放 ${zoomPct}%（点击重置为 100%）`}
            onClick={() => void adjustTerminalFontSize(DEFAULT_FONT_SIZE - activeFontSize)}
          >
            {zoomPct}%
          </button>
          <button
            className="topbar-btn"
            title="放大终端字号"
            onClick={() => void adjustTerminalFontSize(1)}
          >
            <ZoomIn size={15} strokeWidth={1.75} />
          </button>
          <button
            className="topbar-btn"
            title={isDarkMode ? '切换到亮色' : '切换到暗色'}
            onClick={toggleDarkMode}
          >
            {isDarkMode ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
          </button>
          <button
            className={`topbar-btn ${isRightPanelVisible ? 'active' : ''}`}
            title={isRightPanelVisible ? '隐藏助手面板' : '显示助手面板'}
            onClick={toggleRightPanel}
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
        </>
      }
    />
  );
}

/** Top bar variant for the settings view: back button + "设置" title. */
export function SettingsTopBar({ onBack }: { onBack: () => void }) {
  return (
    <TopBar
      leftSlot={
        <button className="topbar-btn" title="返回终端" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </button>
      }
      title="设置"
    />
  );
}
