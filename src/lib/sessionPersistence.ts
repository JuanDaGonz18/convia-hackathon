/**
 * "Recordarme": where the Supabase session is kept.
 * - Remembered: the persistent store (Keychain/Keystore on phones, localStorage
 *   on the web). The user stays signed in.
 * - Not remembered: this session only. sessionStorage on the web (cleared when
 *   the tab closes), memory on phones (cleared when the app closes).
 * The choice itself is kept in the persistent store; with no choice saved yet,
 * sessions are remembered (as they were before this option existed).
 */

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const REMEMBER_KEY = 'convia.session.remember';

/** sessionStorage when the platform has it (web), else memory (phones). */
export function createVolatileStore(): KeyValueStore {
  const browser = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (browser) {
    return {
      getItem: async (key) => browser.getItem(key),
      setItem: async (key, value) => browser.setItem(key, value),
      removeItem: async (key) => browser.removeItem(key),
    };
  }
  const memory = new Map<string, string>();
  return {
    getItem: async (key) => memory.get(key) ?? null,
    setItem: async (key, value) => { memory.set(key, value); },
    removeItem: async (key) => { memory.delete(key); },
  };
}

/**
 * PKCE code verifiers are kept when an e-mail link is requested (sign-up, password reset)
 * and read when the link opens, maybe after the app was closed: they always go to the
 * persistent store. They are single-use, not a session.
 */
const isCodeVerifier = (key: string) => key.endsWith('-code-verifier');

export function createSessionStore(persistent: KeyValueStore, volatile: KeyValueStore) {
  let remember: boolean | null = null;
  const isRemembered = async () => {
    if (remember === null) remember = (await persistent.getItem(REMEMBER_KEY)) !== '0';
    return remember;
  };
  const current = async (key: string) => (isCodeVerifier(key) || (await isRemembered()) ? persistent : volatile);

  return {
    /** The adapter for Supabase's `auth.storage`. */
    storage: {
      getItem: async (key: string) => (await current(key)).getItem(key),
      setItem: async (key: string, value: string) => (await current(key)).setItem(key, value),
      // Removing clears both, so no copy of a session is left behind.
      removeItem: async (key: string) => {
        await Promise.all([persistent.removeItem(key), volatile.removeItem(key)]);
      },
    } satisfies KeyValueStore,

    isRemembered,

    /**
     * Call before signing in. `sessionKeys` are the keys Supabase stores the
     * session under: a copy in the store that is no longer used is deleted.
     */
    async setRemembered(value: boolean, sessionKeys: string[] = []) {
      remember = value;
      await persistent.setItem(REMEMBER_KEY, value ? '1' : '0');
      const unused = value ? volatile : persistent;
      await Promise.all(sessionKeys.map((key) => unused.removeItem(key)));
    },
  };
}
