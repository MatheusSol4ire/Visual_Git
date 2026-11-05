import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { LOG_FORMAT, parseLog } from './parseLog.ts';
import type { Commit } from '../shared/protocol.ts';

export class GitNotFoundError extends Error {}
export class NotARepoError extends Error {}

/** Executa o git instalado na máquina. Usa execFile (sem shell), então nada é interpretado como comando. */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
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
}

/** Descobre a raiz do repositório a partir de uma pasta qualquer dentro dele. */
export async function findRepo(folder: string): Promise<Repo> {
  let root: string;
  try {
    root = (await git(folder, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (error instanceof GitNotFoundError) throw error;
    throw new NotARepoError('Esta pasta não é um repositório Git.');
  }
  return { root, name: basename(root) };
}

export interface CommitPage {
  commits: Commit[];
  hasMore: boolean;
}

/** Lê uma "página" de commits de todas as branches, tags e remotos (menos o stash). */
export async function readCommits(repo: Repo, skip: number, limit: number): Promise<CommitPage> {
  const raw = await git(repo.root, [
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
