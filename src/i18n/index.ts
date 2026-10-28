import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';

import { isLanguagePreference, type Language, type LanguagePreference, LOCALE_TAGS, resolveLanguage } from './languages';
import en from './locales/en.json';
import es from './locales/es.json';

/**
 * App texts in Spanish and English (src/i18n/locales). The user picks Español,
 * English or "Sistema" (the phone's language); the choice is kept on the device.
 * Screens use useTranslation(); dates and prices use localeTag().
 */

const PREFERENCE_KEY = 'convia.language';
const systemLanguageCode = () => getLocales()[0]?.languageCode ?? null;

// The app's own instance; initReactI18next makes it the one useTranslation() uses.
const i18n = createInstance();

let preference: LanguagePreference = 'system';
const listeners = new Set<() => void>();

void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: resolveLanguage('system', systemLanguageCode()),
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
});

export function currentLanguage(): Language {
  return i18n.language === 'en' ? 'en' : 'es';
}

/** For toLocaleString & co.: 'es-CO' or 'en-US'. */
export function localeTag() {
  return LOCALE_TAGS[currentLanguage()];
}

export function getLanguagePreference() {
  return preference;
}

export function subscribeLanguagePreference(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

async function apply(next: LanguagePreference) {
  preference = next;
  await i18n.changeLanguage(resolveLanguage(next, systemLanguageCode()));
  listeners.forEach((listener) => listener());
}

// Set once the user picks a language: a slow startup read must not overwrite that choice.
let chosenThisSession = false;

/** Restores the saved choice at startup (until then the phone's language is used). */
export async function loadLanguagePreference() {
  const saved = await SecureStore.getItemAsync(PREFERENCE_KEY).catch(() => null);
  if (chosenThisSession) return;
  await apply(isLanguagePreference(saved) ? saved : 'system');
}

/**
 * The language changes at once; saving it on the device happens afterwards. Saving first
 * meant a slow or stuck secure store (seen on Android) left the selector unresponsive.
 */
export async function setLanguagePreference(next: LanguagePreference) {
  chosenThisSession = true;
  await apply(next);
  void SecureStore.setItemAsync(PREFERENCE_KEY, next).catch(() => undefined);
}

export default i18n;
