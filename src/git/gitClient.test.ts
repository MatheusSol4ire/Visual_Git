import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
  findGitInPath,
  findRepo,
  GitError,
  GitNotFoundError,
  NotARepoError,
  readBranches,
  readBranchStatus,
  readCommitDetails,
  readCommitPlacement,
  readCommits,
  readHead,
  readTreeEntry,
  toGitError,
} from './gitClient.ts';
import { pickBase } from './branches.ts';

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

test('pasta que sumiu não vira "Git não encontrado"', async () => {
  const error = await findRepo(gitPath, join(base, 'nao-existe')).then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.ok(error instanceof GitError);
  assert.equal(error.kind, 'folderMissing');
  assert.match(error.message, /pasta do projeto não foi encontrada/);
});

test('repositório bloqueado por segurança (dubious ownership) não vira "pasta sem Git"', async () => {
  const folder = join(base, 'outro-dono');
  git(base, 'init', folder);
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = '1';
  try {
    const error = await findRepo(gitPath, folder).then(
      () => undefined,
      (e: unknown) => e,
    );
    assert.ok(error instanceof GitError);
    assert.equal(error.kind, 'unsafe');
    assert.match(error.detail, /dubious ownership/);
  } finally {
    delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  }
});

test('toGitError: mensagens em português e o texto técnico só no detalhe', () => {
  const missing = join(base, 'nao-existe');
  assert.ok(toGitError({ code: 'ENOENT', message: 'spawn git ENOENT' }, '', base) instanceof GitNotFoundError);
  assert.equal((toGitError({ code: 'ENOENT', message: 'spawn git ENOENT' }, '', missing) as GitError).kind, 'folderMissing');
  assert.equal((toGitError({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true, message: 'stdout maxBuffer length exceeded' }, '', base) as GitError).kind, 'tooLarge');
  assert.equal((toGitError({ killed: true, message: 'Command failed: C:\git.exe log' }, '', base) as GitError).kind, 'timeout');

  const stderr = "fatal: ambiguous argument 'x...y': unknown revision or path not in the working tree.";
  const failed = toGitError({ code: 128, message: 'Command failed: C:\git.exe log' }, stderr, base) as GitError;
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.detail, stderr);
  assert.doesNotMatch(failed.message, /fatal|Command failed|git.exe/);

  // Sem stderr, o detalhe guarda a mensagem do Node (com a linha de comando), mas a tela não.
  const quiet = toGitError({ code: 1, message: 'Command failed: C:\git.exe log' }, '', base) as GitError;
  assert.equal(quiet.detail, 'Command failed: C:\git.exe log');
  assert.doesNotMatch(quiet.message, /Command failed/);

  // Texto técnico enorme é cortado.
  assert.ok((toGitError({ code: 1, message: '' }, 'x'.repeat(10_000), base) as GitError).detail.length < 2100);
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

test('"todas" ignora refs internas (stash, notes, backups) e mostra o HEAD solto', async () => {
  const folder = join(base, 'refs-internas');
  git(base, 'init', folder);
  commit(folder, 'a.txt', 'Base');
  commit(folder, 'b.txt', 'Segundo');
  git(folder, 'notes', 'add', '-m', 'uma nota', 'HEAD');
  writeFileSync(join(folder, 'a.txt'), 'mudança guardada');
  git(folder, 'stash');
  // Backup do filter-branch: um commit que só existe em refs/original.
  git(folder, 'checkout', '-q', '-b', 'temporaria');
  commit(folder, 'd.txt', 'Commit reescrito (backup)');
  git(folder, 'update-ref', 'refs/original/refs/heads/temporaria', 'HEAD');
  git(folder, 'checkout', '-q', 'main');
  git(folder, 'branch', '-q', '-D', 'temporaria');
  git(folder, 'checkout', '-q', '--detach', 'HEAD');
  commit(folder, 'c.txt', 'Commit no HEAD solto');

  const repo = await findRepo(gitPath, folder);
  const subjects = (await readCommits(repo, 0, 50)).commits.map((c) => c.subject);
  assert.deepEqual(subjects, ['Commit no HEAD solto', 'Segundo', 'Base']);
});

test('filtro não quebra com branch órfã (sem commits) nem com espaço Unicode no nome', async () => {
  const folder = join(base, 'filtro-preso');
  git(base, 'init', folder);
  commit(folder, 'a.txt', 'Base');
  // NBSP (U+00A0): o Git aceita em nome de branch.
  git(folder, 'checkout', '-q', '-b', 'feature login');
  commit(folder, 'b.txt', 'Login');
  git(folder, 'checkout', '-q', '--orphan', 'gh-pages');

  const repo = await findRepo(gitPath, folder);
  // "Minha branch e a main" estando numa branch órfã: o HEAD sem commit é ignorado.
  const current = await readCommits(repo, 0, 50, ['HEAD', 'refs/heads/main']);
  assert.deepEqual(current.commits.map((c) => c.subject), ['Base']);
  assert.deepEqual((await readCommits(repo, 0, 50, ['HEAD'])).commits, []);

  const nbsp = await readCommits(repo, 0, 50, ['refs/heads/feature login', 'refs/heads/main']);
  assert.deepEqual(nbsp.commits.map((c) => c.subject), ['Login', 'Base']);
  // Espaço comum e caracteres de controle continuam recusados.
  await assert.rejects(readCommits(repo, 0, 50, ['refs/heads/a b']), /Filtro de branches inválido/);
  await assert.rejects(readCommits(repo, 0, 50, ['refs/heads/a\nb']), /Filtro de branches inválido/);
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

test('detalhes do commit: arquivos alterados, renomeados e removidos', async () => {
  const folder = join(base, 'detalhes');
  git(base, 'init', folder);
  writeFileSync(join(folder, 'app.txt'), 'linha 1\nlinha 2\n');
  writeFileSync(join(folder, 'antigo.txt'), 'conteúdo que será renomeado\n'.repeat(5));
  writeFileSync(join(folder, 'apagar.txt'), 'tchau\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-m', 'Primeiro');

  writeFileSync(join(folder, 'app.txt'), 'linha 1\nlinha 2 mudou\nlinha 3\n');
  git(folder, 'mv', 'antigo.txt', 'novo.txt');
  git(folder, 'rm', '-q', 'apagar.txt');
  git(folder, 'add', '.');
  git(folder, 'commit', '-m', 'Organiza arquivos\n\nExplicação mais longa.');

  const repo = await findRepo(gitPath, folder);
  assert.equal(await readHead(repo), 'main');
  const [latest, first] = (await readCommits(repo, 0, 10)).commits;

  const details = await readCommitDetails(repo, latest!.hash);
  assert.equal(details.subject, 'Organiza arquivos');
  assert.equal(details.body, 'Explicação mais longa.');
  assert.equal(details.comparedTo, first!.hash);
  const byPath = Object.fromEntries(details.files.map((f) => [f.path, f]));
  assert.deepEqual(byPath['app.txt'], { path: 'app.txt', status: 'modified', additions: 2, deletions: 1 });
  assert.equal(byPath['novo.txt']?.status, 'renamed');
  assert.equal(byPath['novo.txt']?.oldPath, 'antigo.txt');
  assert.equal(byPath['apagar.txt']?.status, 'deleted');

  // Primeiro commit: tudo aparece como adicionado.
  const root = await readCommitDetails(repo, first!.hash);
  assert.equal(root.comparedTo, null);
  assert.ok(root.files.every((f) => f.status === 'added'));
  assert.equal(root.totalFiles, 3);
});

test('recusa "hash" que tentaria virar uma opção do Git', async () => {
  const repo = await findRepo(gitPath, join(base, 'detalhes'));
  await assert.rejects(readCommitDetails(repo, '--output=/tmp/x'), /Commit inválido/);
});

test('detalhes recusam objetos que não são commits e não confundem hash com arquivo', async () => {
  const folder = join(base, 'detalhes');
  const repo = await findRepo(gitPath, folder);
  // Um arquivo (blob) não é um commit.
  const blob = execFileSync('git', ['hash-object', 'app.txt'], { cwd: folder, env, encoding: 'utf8' }).trim();
  await assert.rejects(readCommitDetails(repo, blob));

  // Um arquivo com o nome exato do hash de um commit não atrapalha.
  const [latest, first] = (await readCommits(repo, 0, 10)).commits;
  writeFileSync(join(folder, latest!.hash), 'x');
  writeFileSync(join(folder, first!.hash), 'x');
  try {
    assert.equal((await readCommitDetails(repo, latest!.hash)).comparedTo, first!.hash);
  } finally {
    rmSync(join(folder, latest!.hash));
    rmSync(join(folder, first!.hash));
  }
});

test('detalhes aparecem mesmo sem o conteúdo dos arquivos (ex.: clone parcial sem internet)', async () => {
  const folder = join(base, 'sem-conteudo');
  git(base, 'init', folder);
  writeFileSync(join(folder, 'antigo.txt'), 'linha que vai junto\n'.repeat(10));
  git(folder, 'add', '.');
  git(folder, 'commit', '-m', 'Primeiro');
  git(folder, 'mv', 'antigo.txt', 'novo.txt');
  writeFileSync(join(folder, 'novo.txt'), 'linha que vai junto\n'.repeat(10) + 'mais uma\n');
  git(folder, 'add', '.');
  git(folder, 'commit', '-m', 'Renomeia e muda');

  // Apaga o conteúdo novo do arquivo, como se ele nunca tivesse sido baixado.
  const blob = execFileSync('git', ['rev-parse', 'HEAD:novo.txt'], { cwd: folder, env, encoding: 'utf8' }).trim();
  const objectFile = join(folder, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
  chmodSync(objectFile, 0o644);
  rmSync(objectFile);

  const repo = await findRepo(gitPath, folder);
  const [latest] = (await readCommits(repo, 0, 10)).commits;
  const details = await readCommitDetails(repo, latest!.hash);
  assert.equal(details.subject, 'Renomeia e muda');
  // Sem o conteúdo, não dá para juntar a renomeação nem contar linhas, mas a lista aparece.
  assert.deepEqual(
    details.files.map((f) => [f.path, f.status, f.additions]).sort(),
    [
      ['antigo.txt', 'deleted', null],
      ['novo.txt', 'added', null],
    ],
  );
});

test('branch sem merge: filtro, comparação com a main e onde cada commit está', async () => {
  const folder = join(base, 'branches');
  git(base, 'init', folder);
  commit(folder, 'a.txt', 'Base');
  git(folder, 'checkout', '-b', 'feature/perfil');
  commit(folder, 'p1.txt', 'Perfil 1');
  commit(folder, 'p2.txt', 'Perfil 2');
  git(folder, 'checkout', 'main');
  commit(folder, 'm.txt', 'Melhora a main');
  git(folder, 'checkout', '-b', 'outra');
  commit(folder, 'o.txt', 'Outra coisa');
  git(folder, 'checkout', 'feature/perfil');

  const repo = await findRepo(gitPath, folder);
  const list = await readBranches(repo);
  assert.deepEqual(
    list.branches.map((b) => [b.name, b.current]),
    [
      ['feature/perfil', true],
      ['main', false],
      ['outra', false],
    ],
  );
  const mainBranch = pickBase(list);
  assert.equal(mainBranch?.name, 'main');

  const feature = list.branches.find((b) => b.name === 'feature/perfil')!;
  assert.deepEqual(await readBranchStatus(repo, mainBranch!.hash, feature.hash), { ahead: 2, behind: 1 });

  // Filtro "minha branch e a main": a branch "outra" fica de fora.
  const filtered = await readCommits(repo, 0, 50, ['HEAD', 'refs/heads/main']);
  assert.deepEqual(filtered.commits.map((c) => c.subject).sort(), ['Base', 'Melhora a main', 'Perfil 1', 'Perfil 2']);
  await assert.rejects(readCommits(repo, 0, 50, ['--output=/tmp/x']), /Filtro de branches inválido/);

  const tip = filtered.commits.find((c) => c.subject === 'Perfil 2')!;
  const placement = await readCommitPlacement(repo, tip.hash);
  assert.equal(placement.inBase, false);
  assert.equal(placement.baseName, 'main');
  assert.deepEqual(placement.branches, [{ name: 'feature/perfil', type: 'branch', current: true }]);

  const shared = filtered.commits.find((c) => c.subject === 'Base')!;
  const sharedPlacement = await readCommitPlacement(repo, shared.hash);
  assert.equal(sharedPlacement.inBase, true);
  assert.equal(sharedPlacement.totalBranches, 3);

  // Os detalhes também trazem essa informação.
  assert.equal((await readCommitDetails(repo, tip.hash)).placement?.inBase, false);
});

test('readTreeEntry reconhece submódulo, arquivo e pasta', async () => {
  const folder = join(base, 'submodulo');
  mkdirSync(folder);
  git(folder, 'init');
  mkdirSync(join(folder, 'src'));
  commit(folder, 'src/app.txt', 'primeiro');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: folder, env, encoding: 'utf8' }).trim();
  // Um submódulo é só um "ponteiro" para um commit de outro repositório (modo 160000).
  git(folder, 'update-index', '--add', '--cacheinfo', `160000,${head},libs/sub`);
  git(folder, 'commit', '-m', 'submodulo');
  const repo = await findRepo(gitPath, folder);
  const last = (await readCommits(repo, 0, 1)).commits[0]?.hash ?? '';

  assert.deepEqual(await readTreeEntry(repo, last, 'libs/sub'), { type: 'commit', hash: head });
  assert.equal((await readTreeEntry(repo, last, 'src/app.txt'))?.type, 'blob');
  assert.equal((await readTreeEntry(repo, last, 'src'))?.type, 'tree');
  assert.equal(await readTreeEntry(repo, last, 'nao-existe.txt'), null);
  assert.equal(await readTreeEntry(repo, last, 'src/*'), null); // curinga não vale
  await assert.rejects(readTreeEntry(repo, '--output=x', 'src'));
});
