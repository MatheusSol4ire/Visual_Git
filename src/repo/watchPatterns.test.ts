import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchPatterns } from './watchPatterns.ts';

test('watchPatterns observa também o formato reftable (HEAD e refs/ ficam fixos nele)', () => {
  assert.deepEqual(watchPatterns('/home/x/proj/.git', '/home/x/proj/.git', 'linux'), [
    { base: '/home/x/proj/.git', glob: 'HEAD' },
    { base: '/home/x/proj/.git', glob: '{packed-refs,refs/**,reftable/**}' },
  ]);
  // No Windows, a mesma pasta escrita de jeitos diferentes não vira dois observadores da reftable/.
  assert.equal(watchPatterns('C:/proj/.git', 'c:\\proj\\.git', 'win32')[0]?.glob, 'HEAD');
});

test('watchPatterns numa worktree: o HEAD dela fica na reftable/ da pasta própria', () => {
  assert.deepEqual(watchPatterns('/p/.git/worktrees/wt', '/p/.git', 'linux'), [
    { base: '/p/.git/worktrees/wt', glob: '{HEAD,reftable/**}' },
    { base: '/p/.git', glob: '{packed-refs,refs/**,reftable/**}' },
  ]);
});
