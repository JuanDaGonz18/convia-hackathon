import { supabase } from '@/lib/supabase';

export type Institution = { name: string; domain: string };

/**
 * The sign-up hint: which institution, if any, owns an e-mail's domain
 * (check_email_domain is granted to anon). The full list of institutions is
 * not readable; signed-in users search it (membershipService.search).
 */
export const institutionService = {
  /** The institution that owns this address's domain, or null if none is enabled. */
  async findByEmail(email: string): Promise<Institution | null> {
    const { data, error } = await supabase.rpc('check_email_domain', { p_email: email });
    if (error) throw error;
    const row = data?.[0];
    return row ? { name: row.nombre, domain: row.dominio } : null;
  },
};
