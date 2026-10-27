import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSessionStore, type KeyValueStore, REMEMBER_KEY } from './sessionPersistence.ts';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
}

const SESSION = 'sb-project-auth-token';

describe('"Recordarme" session storage', () => {
  test('with no choice saved yet, sessions are remembered (as before)', async () => {
    const persistent = memoryStore();
    const store = createSessionStore(persistent, memoryStore());
    await store.storage.setItem(SESSION, 'token');
    assert.equal(await store.isRemembered(), true);
    assert.equal(persistent.data.get(SESSION), 'token');
  });

  test('not remembered: the session lives only in the volatile store', async () => {
    const persistent = memoryStore();
    const volatile = memoryStore();
    const store = createSessionStore(persistent, volatile);
    await store.setRemembered(false);
    await store.storage.setItem(SESSION, 'token');
    assert.equal(volatile.data.get(SESSION), 'token');
    assert.equal(persistent.data.has(SESSION), false);
    assert.equal(persistent.data.get(REMEMBER_KEY), '0');
  });

  test('the choice survives a restart; the volatile session does not', async () => {
    const persistent = memoryStore();
    const first = createSessionStore(persistent, memoryStore());
    await first.setRemembered(false);
    await first.storage.setItem(SESSION, 'token');
    // App restarted: same persistent store, new (empty) volatile store.
    const second = createSessionStore(persistent, memoryStore());
    assert.equal(await second.isRemembered(), false);
    assert.equal(await second.storage.getItem(SESSION), null);
  });

  test('switching to "only this session" deletes the remembered copy of the session', async () => {
    const persistent = memoryStore();
    const store = createSessionStore(persistent, memoryStore());
    await store.storage.setItem(SESSION, 'old-token');
    await store.setRemembered(false, [SESSION]);
    assert.equal(persistent.data.has(SESSION), false);
  });

  test('a PKCE code verifier is always persistent, so an e-mail link works after the app was closed', async () => {
    const persistent = memoryStore();
    const store = createSessionStore(persistent, memoryStore());
    await store.setRemembered(false);
    await store.storage.setItem(`${SESSION}-code-verifier`, 'verifier');
    const afterRestart = createSessionStore(persistent, memoryStore());
    assert.equal(await afterRestart.storage.getItem(`${SESSION}-code-verifier`), 'verifier');
  });

  test('signing out removes the session from both stores', async () => {
    const persistent = memoryStore();
    const volatile = memoryStore();
    persistent.data.set(SESSION, 'a');
    volatile.data.set(SESSION, 'b');
    await createSessionStore(persistent, volatile).storage.removeItem(SESSION);
    assert.equal(persistent.data.has(SESSION) || volatile.data.has(SESSION), false);
  });
});
