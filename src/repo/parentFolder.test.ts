import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparablePath, isOutsideFolder, parentFolderMode } from './parentFolder.ts';

test('parentFolderMode segue o padrão "prompt" do VS Code', () => {
  assert.equal(parentFolderMode('always'), 'always');
  assert.equal(parentFolderMode('never'), 'never');
  assert.equal(parentFolderMode('prompt'), 'prompt');
  assert.equal(parentFolderMode(undefined), 'prompt');
  assert.equal(parentFolderMode('sim'), 'prompt');
});

test('isOutsideFolder no Windows: barras e maiúsculas não importam', () => {
  // O Git devolve "C:/..." e o VS Code "c:\...".
  assert.equal(isOutsideFolder('C:/Users/x/proj', 'c:\\Users\\x\\proj', 'win32'), false);
  assert.equal(isOutsideFolder('C:/Users/x/proj', 'c:\\Users\\x\\proj\\frontend', 'win32'), true);
  assert.equal(isOutsideFolder('C:/Users/x', 'c:\\Users\\x\\proj\\frontend', 'win32'), true);
  assert.equal(isOutsideFolder('D:/proj', 'c:\\proj', 'win32'), true);
  // Uma pasta de dentro cujo nome começa com ".." não é "acima".
  assert.equal(isOutsideFolder('C:/proj/..lib', 'C:\\proj', 'win32'), false);
});

test('isOutsideFolder no Linux diferencia maiúsculas', () => {
  assert.equal(isOutsideFolder('/home/x/proj', '/home/x/proj/', 'linux'), false);
  assert.equal(isOutsideFolder('/home/x/proj', '/home/x/proj/app', 'linux'), true);
  assert.equal(isOutsideFolder('/home/x/Proj', '/home/x/proj', 'linux'), true);
  assert.equal(comparablePath('/Users/X/Proj', 'darwin'), '/users/x/proj');
});
