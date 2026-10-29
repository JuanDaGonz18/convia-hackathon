/** Same check the sign-up form uses: something@something.tld, no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Ana@UniSabana.edu.co " → "unisabana.edu.co"; null until the address looks complete. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed.slice(trimmed.lastIndexOf('@') + 1);
}
