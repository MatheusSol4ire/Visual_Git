import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { LOG_FORMAT, parseLog } from './parseLog.ts';
import type { Commit } from '../shared/protocol.ts';

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
