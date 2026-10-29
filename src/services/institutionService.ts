import { isSupabaseEnabled, supabase } from '@/lib/supabase';

export type Institution = { name: string; domain: string };

/**
 * Institutions whose e-mail domain can sign up. Both reads work before
 * logging in: active institutions are public (institutions_read policy) and
 * check_email_domain is granted to anon.
 */
export const institutionService = {
  /** Active institutions, by name. Empty without a server (demo mode). */
  async listEnabled(): Promise<Institution[]> {
    if (!isSupabaseEnabled) return [];
    const { data, error } = await supabase.from('institutions').select('nombre, dominio').eq('activo', true).order('nombre');
    if (error) throw error;
    return (data ?? []).map((row) => ({ name: row.nombre, domain: row.dominio }));
  },

  /** The institution that owns this address's domain, or null if none is enabled. */
  async findByEmail(email: string): Promise<Institution | null> {
    const { data, error } = await supabase.rpc('check_email_domain', { p_email: email });
    if (error) throw error;
    const row = data?.[0];
    return row ? { name: row.nombre, domain: row.dominio } : null;
  },
};
