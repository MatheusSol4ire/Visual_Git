import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { LOG_FORMAT, parseLog } from './parseLog.ts';
import { parseFileChanges, parseShow, SHOW_FORMAT } from './parseDetails.ts';
import type { Commit, CommitDetails } from '../shared/protocol.ts';

export class GitNotFoundError extends Error {}
export class NotARepoError extends Error {}

/**
 * Procura o executável do Git só nas pastas absolutas do PATH.
 *
 * Segurança: nunca rodamos apenas "git", porque no Windows o sistema procura primeiro
 * na pasta atual — um repositório malicioso poderia trazer um git.exe falso na raiz.
 */
export function findGitInPath(env: NodeJS.ProcessEnv = process.env): string {
  const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(delimiter)) {
    const clean = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!clean || !isAbsolute(clean)) continue; // entradas relativas apontariam para a pasta atual
    for (const name of names) {
      const candidate = join(clean, name);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // não existe nesta pasta; segue procurando
      }
    }
  }
  throw new GitNotFoundError('O Git não foi encontrado no PATH.');
}

/** Executa o Git pelo caminho absoluto. Usa execFile (sem shell), então nada é interpretado como comando. */
function git(gitPath: string, cwd: string, args: string[]): Promise<string> {
  if (!isAbsolute(gitPath)) {
    return Promise.reject(new GitNotFoundError('O caminho do Git precisa ser absoluto.'));
  }
  return new Promise((resolve, reject) => {
    execFile(
      gitPath,
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new GitNotFoundError('O Git não foi encontrado no PATH.'));
          } else {
            reject(new Error(stderr.trim() || error.message));
          }
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export interface Repo {
  root: string;
  name: string;
  /** Caminho absoluto do executável do Git usado para este repositório. */
  gitPath: string;
}

/** Descobre a raiz do repositório a partir de uma pasta qualquer dentro dele. */
export async function findRepo(gitPath: string, folder: string): Promise<Repo> {
  let root: string;
  try {
    root = (await git(gitPath, folder, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (error instanceof GitNotFoundError) throw error;
    throw new NotARepoError('Esta pasta não é um repositório Git.');
  }
  return { root, name: basename(root), gitPath };
}

export interface CommitPage {
  commits: Commit[];
  hasMore: boolean;
}

/** Lê uma "página" de commits de todas as branches, tags e remotos (menos o stash). */
export async function readCommits(repo: Repo, skip: number, limit: number): Promise<CommitPage> {
  const raw = await git(repo.gitPath, repo.root, [
    '-c', 'core.quotepath=off',
    '-c', 'i18n.logOutputEncoding=UTF-8',
    'log',
    '--exclude=refs/stash',
    '--all',
    '--date-order',
    '--decorate=full',
    `--format=${LOG_FORMAT}`,
    `--skip=${skip}`,
    // Pedimos um a mais só para saber se ainda existem commits depois desta página.
    `--max-count=${limit + 1}`,
  ]);
  const commits = parseLog(raw);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

/** Nome da branch atual, ou `null` se o HEAD estiver solto (detached) ou o repositório vazio. */
export async function readHead(repo: Repo): Promise<string | null> {
  try {
    const name = (await git(repo.gitPath, repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Pastas internas do Git: `gitDir` (onde fica o HEAD) e `commonDir` (onde ficam as refs). */
export async function readGitDirs(repo: Repo): Promise<{ gitDir: string; commonDir: string }> {
  const raw = await git(repo.gitPath, repo.root, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
  const [gitDir = '', commonDir = ''] = raw.split(/\r?\n/);
  return { gitDir: gitDir.trim(), commonDir: (commonDir || gitDir).trim() };
}

const HASH = /^[0-9a-f]{4,64}$/i;

/** Garante que o valor é um hash de verdade, para nunca ser lido pelo Git como uma opção. */
export function isCommitHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}

/** Máximo de arquivos enviados para a tela; commits gigantes ficam com a lista cortada. */
const MAX_FILES = 500;

/** Detalhes de um commit: mensagem completa e arquivos alterados (comparados com o primeiro pai). */
export async function readCommitDetails(repo: Repo, hash: string): Promise<CommitDetails> {
  if (!isCommitHash(hash)) throw new Error('Commit inválido.');

  const show = await git(repo.gitPath, repo.root, [
    '-c', 'i18n.logOutputEncoding=UTF-8',
    'show', '-s', '--decorate=full', `--format=${SHOW_FORMAT}`, hash,
  ]);
  const info = parseShow(show);
  if (!info) throw new Error('Não foi possível ler este commit.');

  const comparedTo = info.parents[0] ?? null;
  // Primeiro commit: compara com "nada" (--root). Merges: compara com o primeiro pai.
  const range = comparedTo ? [comparedTo, info.hash] : ['--root', info.hash];
  const base = ['-c', 'core.quotepath=off', 'diff-tree', '-r', '-M', '-z', '--no-commit-id'];
  const [nameStatus, numstat] = await Promise.all([
    git(repo.gitPath, repo.root, [...base, '--name-status', ...range]),
    git(repo.gitPath, repo.root, [...base, '--numstat', ...range]),
  ]);
  const files = parseFileChanges(nameStatus, numstat);

  return {
    hash: info.hash,
    parents: info.parents,
    authorName: info.authorName,
    authorEmail: info.authorEmail,
    date: info.date,
    subject: info.subject,
    refs: info.refs,
    committerName: info.committerName,
    committerDate: info.committerDate,
    body: info.body,
    files: files.slice(0, MAX_FILES),
    totalFiles: files.length,
    comparedTo,
  };
}
