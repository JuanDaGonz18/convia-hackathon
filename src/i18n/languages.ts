/** Languages the app is translated into, and how a saved preference becomes one of them. No React Native imports, so it can be unit-tested with Node. */

export type Language = 'es' | 'en';
export type LanguagePreference = Language | 'system';

export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', 'es', 'en'];

/** Locale tags for dates, times and numbers. */
export const LOCALE_TAGS: Record<Language, string> = { es: 'es-CO', en: 'en-US' };

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return typeof value === 'string' && (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

/**
 * The phone's language decides "system": Spanish stays Spanish, any other known
 * language gets English (more widely read than Spanish among non-Spanish
 * speakers), and an unknown one gets Spanish, the app's original language.
 */
export function languageFromSystem(languageCode: string | null | undefined): Language {
  if (!languageCode) return 'es';
  return languageCode.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function resolveLanguage(preference: LanguagePreference, systemLanguageCode: string | null | undefined): Language {
  return preference === 'system' ? languageFromSystem(systemLanguageCode) : preference;
}

/** Placeholders like {{name}} in a text, sorted: a translation must keep the same ones. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

/** Nested translation object → { "a.b.c": "text" }. */
export function flatten(tree: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, flatten(value as Record<string, unknown>, path));
  }
  return out;
}
