import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { findGitInPath, findRepo, NotARepoError, readCommits } from './gitClient.ts';

// Repositórios de verdade, criados em pasta temporária e apagados no final.
let base: string;
const gitPath = findGitInPath();

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Teste',
  GIT_AUTHOR_EMAIL: 'teste@example.com',
  GIT_COMMITTER_NAME: 'Teste',
  GIT_COMMITTER_EMAIL: 'teste@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env, stdio: 'ignore' });
}

function commit(cwd: string, file: string, message: string): void {
  writeFileSync(join(cwd, file), message);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', message);
}

before(() => {
  base = mkdtempSync(join(tmpdir(), 'visual-git-test-'));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test('pasta sem Git dá NotARepoError', async () => {
  const folder = join(base, 'sem-git');
  mkdirSync(folder);
  await assert.rejects(findRepo(gitPath, folder), NotARepoError);
});

test('repositório sem commits devolve lista vazia', async () => {
  const folder = join(base, 'vazio');
  git(base, 'init', folder);
  const repo = await findRepo(gitPath, folder);
  assert.equal(repo.name, 'vazio');
  const page = await readCommits(repo, 0, 10);
  assert.deepEqual(page, { commits: [], hasMore: false });
});

test('lê branches, tag, merge e paginação', async () => {
  const folder = join(base, 'projeto');
  git(base, 'init', folder);
  commit(folder, 'a.txt', 'Primeiro commit');
  git(folder, 'tag', 'v1.0');
  git(folder, 'checkout', '-b', 'feature/tela');
  commit(folder, 'b.txt', 'Cria a tela');
  git(folder, 'checkout', 'main');
  commit(folder, 'c.txt', 'Ajusta o texto ✨');
  git(folder, 'merge', '--no-ff', 'feature/tela', '-m', 'Junta a tela');

  const repo = await findRepo(gitPath, folder);
  const page = await readCommits(repo, 0, 10);

  assert.equal(page.commits.length, 4);
  assert.equal(page.hasMore, false);

  const merge = page.commits[0];
  assert.equal(merge?.subject, 'Junta a tela');
  assert.equal(merge?.parents.length, 2);
  assert.deepEqual(merge?.refs, [{ name: 'main', type: 'branch', current: true }]);

  const subjects = page.commits.map((c) => c.subject);
  assert.ok(subjects.includes('Ajusta o texto ✨'), 'acentos e emoji preservados');

  const first = page.commits.find((c) => c.subject === 'Primeiro commit');
  assert.deepEqual(first?.parents, []);
  assert.deepEqual(first?.refs, [{ name: 'v1.0', type: 'tag' }]);

  const feature = page.commits.find((c) => c.subject === 'Cria a tela');
  assert.deepEqual(feature?.refs, [{ name: 'feature/tela', type: 'branch' }]);

  // Paginação: 2 por página.
  const p1 = await readCommits(repo, 0, 2);
  const p2 = await readCommits(repo, 2, 2);
  assert.equal(p1.hasMore, true);
  assert.equal(p2.hasMore, false);
  assert.deepEqual(
    [...p1.commits, ...p2.commits].map((c) => c.hash),
    page.commits.map((c) => c.hash),
  );
});

test('nunca usa um git falso plantado na pasta do projeto', async () => {
  const folder = join(base, 'malicioso');
  git(base, 'init', folder);
  const fake = join(folder, process.platform === 'win32' ? 'git.exe' : 'git');
  writeFileSync(fake, 'falso');

  // Mesmo com "." no PATH, a busca ignora caminhos relativos.
  const found = findGitInPath({ PATH: ['.', process.env.PATH ?? process.env.Path ?? ''].join(delimiter) });
  assert.notEqual(found, fake);
  assert.ok(isAbsolute(found));

  const repo = await findRepo(found, folder);
  assert.equal(repo.gitPath, found);
});

test('PATH sem Git dá erro claro', () => {
  assert.throws(() => findGitInPath({ PATH: join(base, 'nada-aqui') }), /Git não foi encontrado/);
});
