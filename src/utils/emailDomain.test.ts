import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emailDomain } from './emailDomain.ts';

test('the domain of a complete address, lowercased and trimmed', () => {
  assert.equal(emailDomain('Ana@UniSabana.edu.co '), 'unisabana.edu.co');
  assert.equal(emailDomain('a.b+c@sub.example.org'), 'sub.example.org');
});

test('no domain while the address is still being typed', () => {
  for (const partial of ['', 'ana', 'ana@', 'ana@unisabana', 'ana @unisabana.edu.co']) {
    assert.equal(emailDomain(partial), null, partial);
  }
});
