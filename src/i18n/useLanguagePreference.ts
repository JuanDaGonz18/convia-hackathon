import { useCallback, useSyncExternalStore } from 'react';

import { supabase, isSupabaseEnabled } from '@/lib/supabase';

import { currentLanguage, getLanguagePreference, setLanguagePreference, subscribeLanguagePreference } from './index';
import type { LanguagePreference } from './languages';

/**
 * The language choice for selectors. Changing it also saves the resulting
 * language in the user's account (user_metadata.locale) when signed in, so
 * e-mails and notifications can use it.
 */
export function useLanguagePreference() {
  const preference = useSyncExternalStore(subscribeLanguagePreference, getLanguagePreference, getLanguagePreference);
  const change = useCallback(async (next: LanguagePreference) => {
    await setLanguagePreference(next);
    if (!isSupabaseEnabled) return;
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.auth.updateUser({ data: { locale: currentLanguage() } }).catch(() => undefined);
  }, []);
  return [preference, change] as const;
}
