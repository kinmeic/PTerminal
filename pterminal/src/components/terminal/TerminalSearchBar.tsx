import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react';
import { terminalRegistry } from '@/services/terminalRegistry';
import { useAppStore } from '@/stores/appStore';
import { useI18n } from '@/i18n/I18nProvider';

interface TerminalSearchBarProps {
  terminalId: string;
}

/**
 * Highlight colors for search matches. Passing `decorations` is what makes the
 * SearchAddon report `resultCount` / `resultIndex` via `onDidChangeResults`.
 */
const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(255, 211, 61, 0.25)',
  matchBorder: 'rgba(255, 211, 61, 0.6)',
  matchOverviewRuler: 'rgba(255, 211, 61, 0.5)',
  activeMatchBackground: 'rgba(255, 211, 61, 0.55)',
  activeMatchBorder: 'rgba(255, 211, 61, 0.9)',
  activeMatchColorOverviewRuler: 'rgba(255, 211, 61, 1)',
};

/**
 * Floating find bar for terminal content, toggled by Cmd+F. Lives in the
 * top-right corner of the center panel and drives the active terminal's
 * SearchAddon: typing highlights matches, Enter/next jumps forward,
 * Shift+Enter/prev jumps back, Esc closes. The match counter ("3/12") is
 * kept in sync with the addon's `onDidChangeResults` event.
 */
export function TerminalSearchBar({ terminalId }: TerminalSearchBarProps) {
  const [keyword, setKeyword] = useState('');
  const [resultIndex, setResultIndex] = useState(-1);
  const [resultCount, setResultCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setSearchBarVisible = useAppStore((s) => s.setSearchBarVisible);
  const { t } = useI18n();

  const doSearch = (direction: 'next' | 'prev') => {
    const addon = terminalRegistry.getSearch(terminalId);
    if (!addon || !keyword) return;
    const found =
      direction === 'next'
        ? addon.findNext(keyword, { decorations: SEARCH_DECORATIONS })
        : addon.findPrevious(keyword, { decorations: SEARCH_DECORATIONS });
    if (!found) {
      setResultCount(0);
      setResultIndex(-1);
    }
  };

  // Keep the match counter in sync. The addon fires `onDidChangeResults` with
  // the running total + current index whenever a search resolves.
  useEffect(() => {
    const addon = terminalRegistry.getSearch(terminalId);
    if (!addon) return;
    const disposable = addon.onDidChangeResults((e) => {
      // Defensive: ignore stale events if this addon no longer backs the bar.
      if (terminalRegistry.getSearch(terminalId) !== addon) return;
      const count = e.resultCount ?? 0;
      setResultCount(count < 0 ? 0 : count);
      setResultIndex(e.resultIndex ?? -1);
    });
    return () => disposable.dispose();
  }, [terminalId]);

  // Auto-focus the input on mount so the user can type immediately after Cmd+F.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Clear highlights when the bar unmounts (terminal switch / close).
  useEffect(() => {
    return () => {
      terminalRegistry.getSearch(terminalId)?.clearDecorations();
    };
  }, [terminalId]);

  const close = () => setSearchBarVisible(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setKeyword(value);
    const addon = terminalRegistry.getSearch(terminalId);
    if (!addon) return;
    if (!value) {
      addon.clearDecorations();
      setResultCount(0);
      setResultIndex(-1);
      return;
    }
    // Typing re-runs the search forward and jumps to the first (nearest) match.
    const found = addon.findNext(value, { decorations: SEARCH_DECORATIONS });
    if (!found) {
      setResultCount(0);
      setResultIndex(-1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(e.shiftKey ? 'prev' : 'next');
    }
  };

  const hasResults = resultCount > 0;
  const countLabel = keyword ? (hasResults ? `${resultIndex + 1}/${resultCount}` : t('search.noResults')) : '';

  return (
    <div className="terminal-search-bar">
      <Search size={13} strokeWidth={1.75} className="terminal-search-icon" />
      <input
        ref={inputRef}
        className="terminal-search-input"
        placeholder={t('search.placeholder')}
        value={keyword}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      <span className="terminal-search-count">{countLabel}</span>
      <button
        className="terminal-search-btn"
        title={t('search.previous')}
        onClick={() => doSearch('prev')}
        disabled={!hasResults}
      >
        <ChevronUp size={14} strokeWidth={1.75} />
      </button>
      <button
        className="terminal-search-btn"
        title={t('search.next')}
        onClick={() => doSearch('next')}
        disabled={!hasResults}
      >
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      <button
        className="terminal-search-btn"
        title={t('search.close')}
        onClick={close}
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
