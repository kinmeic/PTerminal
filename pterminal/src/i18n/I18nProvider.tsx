import { createContext, useContext, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  translate,
  resolveLocale,
  type Locale,
} from '@/i18n/translations';

/**
 * Translation function type: takes a dotted key and optional `{name}`
 * placeholder params, returns the localized string.
 */
type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  /** The user's explicit choice (null = follow system). */
  locale: Locale | null;
  /** The locale actually in effect (user choice, else detected system). */
  effectiveLocale: Locale;
  t: TFunc;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Provides the active locale + `t()` to the React tree. The effective locale is
 * the user's saved choice (read from the store, null = follow system), resolved
 * against the detected system language. Components call `useI18n()` to get `t`;
 * when the user changes the language in settings, the store updates and every
 * consumer re-renders with the new strings.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const language = useAppStore((s) => s.language);
  const effectiveLocale = resolveLocale(language);

  // Memoize so `t` keeps a stable identity unless the locale actually changes.
  const value = useMemo<I18nContextValue>(
    () => ({
      locale: language,
      effectiveLocale,
      t: (key, params) => translate(effectiveLocale, key, params),
    }),
    [language, effectiveLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Access the active locale and `t()` translation function. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}
