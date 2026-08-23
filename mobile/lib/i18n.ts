import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { useCallback } from 'react';

import en from './locales/en.json';

const KEY_LANGUAGE = 'scaffold.language';

export const SUPPORTED_LANGUAGES = ['en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/** Native-tongue display names, shown in the language picker so a user can
 *  find their language regardless of what the UI is currently set to. Add an
 *  entry here when you register a new locale below. */
export const LANGUAGE_NATIVE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
};

export const resources = {
  en: { translation: en },
} as const;

function detectLanguage(): SupportedLanguage {
  const supported = SUPPORTED_LANGUAGES as readonly string[];
  const locales = getLocales();
  for (const l of locales) {
    const tag = (l.languageTag ?? '').toLowerCase();
    const code = (l.languageCode ?? '').toLowerCase();
    // Try the most specific match first: tag prefix (e.g. "zh-Hans" from
    // "zh-Hans-CN"), then the bare language code.
    const tagMatch = supported.find((s) => tag.startsWith(s.toLowerCase()));
    if (tagMatch) return tagMatch as SupportedLanguage;
    if (supported.includes(code)) return code as SupportedLanguage;
  }
  return FALLBACK_LANGUAGE;
}

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      compatibilityJSON: 'v4',
      resources,
      lng: detectLanguage(),
      fallbackLng: FALLBACK_LANGUAGE,
      defaultNS: 'translation',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  // After sync init, async-load the user's explicit choice (if any) and
  // switch to it. Brief device-locale → stored-choice flash on cold boot
  // is acceptable; the alternative (async-init) would block app startup.
  SecureStore.getItemAsync(KEY_LANGUAGE)
    .then((stored) => {
      if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
        if (i18n.language !== stored) {
          i18n.changeLanguage(stored);
        }
      }
    })
    .catch(() => {
      // SecureStore can throw before the keychain is unlocked on iOS; the
      // user can re-pick from the You tab if their stored choice is lost.
    });
}

/** Persist the user's explicit language choice and switch to it now. */
export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    await SecureStore.setItemAsync(KEY_LANGUAGE, lang);
  } catch {
    // Non-fatal — the in-memory switch already happened.
  }
}

/** BCP-47 locale tag for Intl.* APIs — uses the device's region when available. */
export function currentLocale(): string {
  const locales = getLocales();
  const first = locales[0];
  if (first?.languageTag) return first.languageTag;
  return i18n.language || FALLBACK_LANGUAGE;
}

/** Localized date string (short form). */
export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(currentLocale());
}

/**
 * Localized long date ("Sunday, 23 August 2026") for a YYYY-MM-DD string.
 * The string is a local calendar date (it's how the Log keys "today"), so
 * build the Date from its parts rather than parsing it — `new Date('YYYY-MM-DD')`
 * would read it as UTC midnight and shift the day west of Greenwich.
 */
export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(currentLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Localized time string (HH:MM). */
export function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** Returns a `t` function that always resolves keys in English, regardless of
 *  the user's selected app language. Used by the login screen where the user
 *  hasn't yet confirmed they understand the UI language — the detected device
 *  locale can be wrong (shared/borrowed device, multilingual users) and getting
 *  stuck unable to read the sign-in screen is fatal. */
export function useEnglishT(): (key: string, opts?: Record<string, unknown>) => string {
  return useCallback(
    (key: string, opts?: Record<string, unknown>) =>
      i18n.t(key, { ...(opts ?? {}), lng: 'en' }) as string,
    [],
  );
}

export default i18n;
