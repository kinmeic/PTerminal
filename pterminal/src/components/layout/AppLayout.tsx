import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Resizer } from './Resizer';
import { LeftPanel } from './LeftPanel';
import { CenterPanel } from './CenterPanel';
import { RightPanel } from './RightPanel';
import { TerminalTopBar } from './TopBar';

export function AppLayout() {
  const leftWidth = useAppStore((s) => s.leftWidth);
  const rightWidth = useAppStore((s) => s.rightWidth);
  const isLeftPanelVisible = useAppStore((s) => s.isLeftPanelVisible);
  const isRightPanelVisible = useAppStore((s) => s.isRightPanelVisible);
  const isLeftPanelHovering = useAppStore((s) => s.isLeftPanelHovering);
  const isDarkMode = useAppStore((s) => s.isDarkMode);
  const setLeftWidth = useAppStore((s) => s.setLeftWidth);
  const setRightWidth = useAppStore((s) => s.setRightWidth);
  const persistPanelWidths = useAppStore((s) => s.persistPanelWidths);
  const setLeftPanelHovering = useAppStore((s) => s.setLeftPanelHovering);
  const scheduleLeftPanelHoverHide = useAppStore((s) => s.scheduleLeftPanelHoverHide);
  const cancelLeftPanelHoverHide = useAppStore((s) => s.cancelLeftPanelHoverHide);

  const handleOverlayEnter = () => {
    // Cancels the hide the button armed on leave — this is what keeps the
    // overlay open as the mouse travels from the button onto it.
    cancelLeftPanelHoverHide();
    setLeftPanelHovering(true);
  };

  const handleOverlayLeave = () => {
    scheduleLeftPanelHoverHide();
  };

  useEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      isDarkMode ? 'dark' : 'light'
    );
  }, [isDarkMode]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Top bar — spans the whole window (replaces native title bar). */}
      <TerminalTopBar />

      {/* Three-column body. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left column — collapsible */}
        {isLeftPanelVisible ? (
          <>
            <div style={{ width: leftWidth, flexShrink: 0 }} className="panel-sidebar h-full">
              <LeftPanel />
            </div>
            <Resizer onResize={(delta) => setLeftWidth(delta)} onResizeEnd={persistPanelWidths} />
          </>
        ) : null}

        {/* Left panel hover overlay — shows when collapsed and hovering */}
        {!isLeftPanelVisible && isLeftPanelHovering && (
          <div
            className="panel-sidebar panel-sidebar-overlay"
            style={{ width: leftWidth }}
            onMouseEnter={handleOverlayEnter}
            onMouseLeave={handleOverlayLeave}
          >
            <LeftPanel />
          </div>
        )}

        {/* Center column — always visible */}
        <div
          className="flex-1 min-w-0 h-full"
          style={{ backgroundColor: 'var(--color-sidebar-center)' }}
        >
          <CenterPanel />
        </div>

        {/* Right column — collapsible */}
        {isRightPanelVisible ? (
          <>
            <Resizer onResize={(delta) => setRightWidth(-delta)} onResizeEnd={persistPanelWidths} />
            <div
              style={{ width: rightWidth, flexShrink: 0 }}
              className="panel-sidebar panel-sidebar-right h-full"
            >
              <RightPanel />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
