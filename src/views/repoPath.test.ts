import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFilePath } from './repoPath.ts';

test('repoFilePath aceita arquivos cujo nome começa com ".."', () => {
  assert.equal(repoFilePath('C:\\Users\\x\\repo', '..env.example', 'win32'), 'C:\\Users\\x\\repo\\..env.example');
  assert.equal(repoFilePath('C:\\Users\\x\\repo', '..config/settings.json', 'win32'), 'C:\\Users\\x\\repo\\..config\\settings.json');
  assert.equal(repoFilePath('C:\\Users\\x\\repo', '...', 'win32'), 'C:\\Users\\x\\repo\\...');
  assert.equal(repoFilePath('/home/x/repo', '..env.example', 'linux'), '/home/x/repo/..env.example');
  assert.equal(repoFilePath('/home/x/repo', 'docs/..notes.md', 'linux'), '/home/x/repo/docs/..notes.md');
});

test('repoFilePath continua recusando caminhos que saem do repositório', () => {
  for (const [root, path, platform] of [
    ['C:\\Users\\x\\repo', '../fora.txt', 'win32'],
    ['C:\\Users\\x\\repo', '..\\fora.txt', 'win32'],
    ['C:\\Users\\x\\repo', 'a/../../fora.txt', 'win32'],
    ['C:\\Users\\x\\repo', '..', 'win32'],
    ['C:\\Users\\x\\repo', '', 'win32'],
    ['/home/x/repo', '../fora.txt', 'linux'],
    ['/home/x/repo', 'a/../../../etc/passwd', 'linux'],
    ['/home/x/repo', '..', 'linux'],
    ['/home/x/repo', '.', 'linux'],
  ] as const) {
    assert.equal(repoFilePath(root, path, platform), undefined, `${platform}: ${path}`);
  }
});
