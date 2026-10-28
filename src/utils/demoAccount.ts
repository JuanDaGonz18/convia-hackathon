/** Judges' demo accounts live under this domain (hackathon project only). */
export const DEMO_EMAIL_DOMAIN = '@demo.convia.test';

export function isDemoAccount(email: string | null | undefined) {
  return !!email && email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}
