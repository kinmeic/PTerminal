import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { terminalRegistry } from '@/services/terminalRegistry';
import { useAppStore } from '@/stores/appStore';
import { useI18n } from '@/i18n/I18nProvider';

interface TerminalAutocompleteProps {
  terminalId: string;
  suggestions: string[];
  selectedIndex: number;
  visible: boolean;
  loading: boolean;
  /** The text the user has typed so far, used to show only the missing suffix
   *  in inline ghost mode (avoids overlapping what's already on the line). */
  currentInput: string;
  /** Predicted cursor cell from the input hook; used while PTY echo lags. */
  cursorX?: number | null;
  cursorY?: number | null;
}

interface TermCore {
  _renderService?: {
    dimensions?: {
      css: { cell: { width: number; height: number } };
    };
  };
}

interface Geom {
  left: number;
  top: number;
  cellW: number;
  cellH: number;
  font: string;
  /** Viewport height — used to decide whether the menu opens up or down. */
  vh: number;
  /** Viewport width — used to keep inline ghost text inside the app window. */
  vw: number;
  /** Horizontal bounds of the terminal surface. */
  boundaryLeft: number;
  boundaryRight: number;
}

/** Max menu rows before it scrolls. */
const MAX_VISIBLE_ITEMS = 6;
const MENU_MARGIN = 8;
const MENU_MIN_WIDTH = 190;
const MENU_MAX_WIDTH = 480;
const ITEM_HORIZONTAL_PADDING = 16;

/**
 * Renders autocomplete suggestions over the terminal:
 * - 1 candidate  → inline ghost text at the cursor.
 * - 2+ candidates → popup menu. Opens DOWN by default, but flips UP when the
 *   cursor is near the bottom of the viewport so the menu isn't clipped.
 * The menu has a max height and scrolls when there are more items than
 * MAX_VISIBLE_ITEMS.
 *
 * Portaled to document.body so `position: fixed` is viewport-relative.
 */
export function TerminalAutocomplete({
  terminalId,
  suggestions,
  selectedIndex,
  visible,
  currentInput,
  cursorX,
  cursorY,
}: TerminalAutocompleteProps) {
  const [geom, setGeom] = useState<Geom | null>(null);
  const cursorRef = useRef<{ x?: number | null; y?: number | null }>({});
  cursorRef.current = { x: cursorX, y: cursorY };

  // Read the terminal font from app settings (the same source the xterm
  // instance uses), so the menu/ghost text always matches the configured font
  // family AND per-terminal zoom level.
  const fontFamily = useAppStore((s) => s.fontFamily);
  const terminals = useAppStore((s) => s.terminals);
  const terminal = terminals.find((t) => t.id === terminalId);
  const globalFontSize = useAppStore((s) => s.fontSize);
  const fontSize = terminal?.fontSize ?? globalFontSize;
  const isDarkMode = useAppStore((s) => s.isDarkMode);
  const { t } = useI18n();

  const recompute = () => {
    const term = terminalRegistry.getTerminal(terminalId);
    if (!term || !term.element) {
      setGeom(null);
      return;
    }

    const layerEl =
      term.element.querySelector<HTMLElement>('.xterm-rows') ??
      term.element.querySelector<HTMLElement>('.xterm-screen') ??
      term.element;
    const layerRect = layerEl.getBoundingClientRect();
    const terminalRect = term.element.getBoundingClientRect();

    let cellW = 0;
    let cellH = 0;
    const core = (term as unknown as { _core?: TermCore })._core;
    const dims = core?._renderService?.dimensions;
    if (dims?.css?.cell) {
      cellW = dims.css.cell.width;
      cellH = dims.css.cell.height;
    }
    if (!cellW || !cellH) {
      const computed = getComputedStyle(term.element);
      const fs = parseFloat(computed.fontSize) || 13;
      cellW = fs * 0.6018;
      cellH = fs * 1.2;
    }

    // Font: use the settings-configured family + per-terminal font size so the
    // menu/ghost text matches what the terminal actually renders. This is the
    // same source the xterm Terminal is created with.
    const font = `${fontSize}px ${fontFamily}`;

    const buffer = term.buffer.active;
    const predicted = cursorRef.current;
    const x = predicted.x ?? buffer.cursorX;
    const y = predicted.y ?? buffer.cursorY;
    const left = layerRect.left + x * cellW;
    const top = layerRect.top + y * cellH;

    setGeom({
      left,
      top,
      cellW,
      cellH,
      font,
      vh: window.innerHeight,
      vw: window.innerWidth,
      boundaryLeft: terminalRect.left,
      boundaryRight: terminalRect.right,
    });
  };

  useEffect(() => {
    if (!visible || suggestions.length === 0) {
      setGeom(null);
      return;
    }
    recompute();
    // currentInput is a dependency because inline ghost position depends on the
    // cursor column, which moves as the user types. Without this, the ghost
    // text stays at a stale X after continued typing (e.g. menu → inline switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, suggestions, selectedIndex, visible, fontFamily, fontSize, currentInput, cursorX, cursorY]);

  useEffect(() => {
    if (!visible) return;
    const term = terminalRegistry.getTerminal(terminalId);
    if (!term?.element) return;

    const viewport = term.element.querySelector<HTMLElement>('.xterm-viewport');
    const handler = () => recompute();
    const cursorDisposable = term.onCursorMove(handler);
    const parsedDisposable = term.onWriteParsed(handler);
    viewport?.addEventListener('scroll', handler);
    window.addEventListener('resize', handler);
    return () => {
      cursorDisposable.dispose();
      parsedDisposable.dispose();
      viewport?.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, visible, suggestions]);

  if (!visible || suggestions.length === 0 || !geom) return null;
  if (terminalRegistry.isSensitiveInputPrompt(terminalId)) return null;

  const isMenu = suggestions.length > 1;
  const itemHeight = geom.cellH + 6; // padding included

  // ---- Single candidate: inline ghost text ----
  // IMPORTANT: inline ghost lives ON the cursor line, so it must show only the
  // MISSING suffix (not the full command) to avoid overlapping what the user
  // already typed. e.g. user typed "git s", full cmd "git status" → show "tatus".
  //
  // We use `currentInput` (not xterm's buffer line text) for the suffix
  // computation because currentInput updates synchronously on each keystroke,
  // while the xterm buffer lags by one render (the PTY echo hasn't arrived yet).
  // The X POSITION still comes from buffer.cursorX via geom.left, which is
  // accurate by the time the debounce window elapses.
  if (!isMenu) {
    const fullCmd = suggestions[0];
    const suffix = computeSuffix(currentInput, fullCmd);
    if (!suffix) return null;
    const inlineRight = Math.min(geom.boundaryRight, geom.vw) - MENU_MARGIN;
    const inlineWidth = Math.max(0, Math.min(geom.cellW * suffix.length + 12, inlineRight - geom.left));
    if (inlineWidth <= 0) return null;
    const overlay = (
      <div
        style={{
          position: 'fixed',
          left: geom.left,
          top: geom.top,
          height: geom.cellH,
          width: inlineWidth,
          zIndex: 100,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            font: geom.font,
            lineHeight: `${geom.cellH}px`,
            whiteSpace: 'pre',
            color: 'var(--color-text-muted, #8b949e)',
            opacity: 0.45,
            display: 'block',
          }}
        >
          {suffix}
        </span>
      </div>
    );
    return createPortal(overlay, document.body);
  }

  // ---- Multiple candidates: popup menu ----
  // Decide direction: if there's not enough room below the cursor for at least
  // 3 rows, open upward instead.
  const spaceBelow = geom.vh - (geom.top + geom.cellH);
  const openUpward = spaceBelow < itemHeight * 3;

  // Show at most MAX_VISIBLE_ITEMS rows; the list scrolls internally via
  // translateY. The hint bar is a separate fixed-height row below.
  const visibleCount = Math.min(MAX_VISIBLE_ITEMS, suggestions.length);
  const listHeight = itemHeight * visibleCount;
  // Total = list + hint bar (~22px) + container padding (8px).
  const hintHeight = 22;
  const totalHeight = listHeight + hintHeight + 8;
  const contentWidth = Math.max(...suggestions.map((s) => s.length)) * geom.cellW + 24;
  const maxAvailableWidth = Math.max(
    64,
    Math.min(MENU_MAX_WIDTH, geom.boundaryRight - geom.boundaryLeft - MENU_MARGIN * 2, geom.vw - MENU_MARGIN * 2)
  );
  const minMenuWidth = Math.min(MENU_MIN_WIDTH, maxAvailableWidth);
  const menuWidth = clamp(Math.max(contentWidth, minMenuWidth), minMenuWidth, maxAvailableWidth);
  const menuLeft = clamp(
    geom.left,
    Math.max(MENU_MARGIN, geom.boundaryLeft + MENU_MARGIN),
    Math.min(geom.vw - menuWidth - MENU_MARGIN, geom.boundaryRight - menuWidth - MENU_MARGIN)
  );
  const menuBackground = isDarkMode ? '#2B2B2B' : 'var(--color-bg-secondary, #f6f8fa)';
  const menuBorder = isDarkMode ? '#414141' : 'var(--color-border, #d0d7de)';
  const selectedBackground = isDarkMode ? 'var(--color-accent, #2f6fdb)' : '#EAEEF2';

  // Auto-scroll so the selected item is always visible.
  const scrollOffset = Math.max(0, selectedIndex - visibleCount + 1) * itemHeight;
  const itemTextWidth = Math.max(0, menuWidth - ITEM_HORIZONTAL_PADDING);

  const menu = (
    <div
      style={{
        position: 'fixed',
        left: menuLeft,
        // Anchor: just below the cursor line (down) or just above (up).
        top: openUpward ? geom.top - totalHeight - 4 : geom.top + geom.cellH + 2,
        zIndex: 100,
        width: menuWidth,
        // Fixed total height — list area + hint bar, no flex compression.
        height: totalHeight,
        backgroundColor: menuBackground,
        border: `1px solid ${menuBorder}`,
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        padding: 4,
        font: geom.font,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Scrollable list area: fixed height, overflow hidden, items moved by
          translateY to simulate scrolling toward the selection. */}
      <div style={{ height: listHeight, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ transform: `translateY(-${scrollOffset}px)` }}>
          {suggestions.map((text, idx) => {
            const isSelected = idx === selectedIndex;
            const shouldScroll = isSelected && text.length * geom.cellW > itemTextWidth;
            const scrollDistance = Math.max(0, text.length * geom.cellW - itemTextWidth + 8);
            return (
              <div
                key={idx}
                title={text}
                style={{
                  height: itemHeight,
                  padding: '0 8px',
                  borderRadius: 4,
                  lineHeight: `${geom.cellH}px`,
                  whiteSpace: 'pre',
                  overflow: 'hidden',
                  color: isSelected
                    ? 'var(--color-text-primary, #fff)'
                    : 'var(--color-text-muted, #8b949e)',
                  backgroundColor: isSelected ? selectedBackground : 'transparent',
                }}
              >
                <span
                  style={
                    {
                      display: 'inline-block',
                      maxWidth: shouldScroll ? 'none' : '100%',
                      overflow: shouldScroll ? 'visible' : 'hidden',
                      textOverflow: shouldScroll ? 'clip' : 'ellipsis',
                      verticalAlign: 'top',
                      animation: shouldScroll
                        ? 'terminal-autocomplete-scroll 5.5s ease-in-out 0.45s infinite alternate'
                        : undefined,
                      '--scroll-distance': `${scrollDistance}px`,
                    } as CSSProperties
                  }
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {/* Hint bar: pinned at the bottom, never compressed. */}
      <div
        style={{
          height: hintHeight,
          padding: '0 8px',
          fontSize: 10,
          lineHeight: `${hintHeight}px`,
          color: 'var(--color-text-muted, #666)',
          borderTop: `1px solid ${menuBorder}`,
          marginTop: 2,
          flexShrink: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {t('autocomplete.hint')}
      </div>
      <style>
        {`
          @keyframes terminal-autocomplete-scroll {
            from { transform: translateX(0); }
            to { transform: translateX(calc(-1 * var(--scroll-distance, 0px))); }
          }
        `}
      </style>
    </div>
  );

  return createPortal(menu, document.body);
}

/**
 * Compute the suffix to append so that `current + suffix == full`.
 * Used by inline ghost mode to show only the missing part.
 */
function computeSuffix(current: string, full: string): string {
  if (full.startsWith(current)) {
    return full.slice(current.length);
  }
  // Case-insensitive prefix match.
  if (full.toLowerCase().startsWith(current.toLowerCase())) {
    return full.slice(current.length);
  }
  // No shared prefix — show the whole thing.
  return full;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
