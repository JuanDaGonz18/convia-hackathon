/**
 * The legal documents in the app's language. Spanish (legal.ts) is the binding text; the English
 * version (legal.en.json, made with scripts/translate-legal.mjs) is a translation, and the screen
 * says so. The translation pipeline stores arrays as objects keyed "0", "1"…; they are rebuilt here.
 */
import english from '@/content/legal.en.json';
import { LEGAL_UPDATED_AT, type LegalDocument, PRIVACY, TERMS } from '@/content/legal';

/** Objects keyed 0..n-1 back into arrays, recursively. */
export function restoreArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreArrays);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const isArray = entries.length > 0 && entries.every(([key], index) => key === String(index));
  return isArray ? entries.map(([, item]) => restoreArrays(item)) : Object.fromEntries(entries.map(([key, item]) => [key, restoreArrays(item)]));
}

const EN = restoreArrays(english) as { updatedAt: string; terms: LegalDocument; privacy: LegalDocument };

export function legalDocuments(language: string): { terms: LegalDocument; privacy: LegalDocument; updatedAt: string; translated: boolean } {
  if (language.startsWith('en')) return { terms: EN.terms, privacy: EN.privacy, updatedAt: EN.updatedAt, translated: true };
  return { terms: TERMS, privacy: PRIVACY, updatedAt: LEGAL_UPDATED_AT, translated: false };
}
