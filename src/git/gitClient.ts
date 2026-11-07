import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { LOG_FORMAT, parseLog } from './parseLog.ts';
import { parseFileChanges, parseShow, SHOW_FORMAT } from './parseDetails.ts';
import { BRANCH_FORMAT, parseBranches, pickBase, type BranchList } from './branches.ts';
import type { BranchStatus, Commit, CommitDetails, CommitPlacement } from '../shared/protocol.ts';

export class GitNotFoundError extends Error {}
export class NotARepoError extends Error {}

export type GitErrorKind = 'failed' | 'timeout' | 'tooLarge' | 'folderMissing' | 'unsafe';

/** Mensagens mostradas na tela: em português, sem jargão, dizendo o que fazer. */
const GIT_ERROR_MESSAGES: Record<GitErrorKind, string> = {
  failed: 'O Git não conseguiu ler as informações do projeto. Os detalhes técnicos estão em Saída › Visual Git.',
  timeout: 'O Git demorou demais para responder e a leitura foi cancelada. Tente de novo daqui a pouco.',
  tooLarge: 'Há informação demais para mostrar de uma vez.',
  folderMissing: 'A pasta do projeto não foi encontrada. Ela pode ter sido movida, apagada ou estar num disco desconectado.',
  unsafe:
    'O Git bloqueou esta pasta por segurança, porque ela pertence a outro usuário do computador (comum em HD externo, pendrive ou pasta de rede). ' +
    'Se você confia nela, abra a paleta de comandos do VS Code (Ctrl+Shift+P) e procure por "Unsafe Repositories" para liberá-la.',
};

/** Tamanho máximo do texto técnico guardado para o log. */
const MAX_DETAIL = 2000;

/** Falha do Git: `message` vai para a tela; `detail` (o texto técnico do Git) vai só para o log. */
export class GitError extends Error {
  readonly kind: GitErrorKind;
  readonly detail: string;

  constructor(kind: GitErrorKind, detail = '') {
    super(GIT_ERROR_MESSAGES[kind]);
    this.kind = kind;
    this.detail = detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
  }
}

/** O que o `execFile` devolve quando o comando falha (só o que usamos). */
interface ExecFailure {
  code?: unknown;
  killed?: boolean;
  message: string;
}

/** Transforma a falha de um comando num erro com mensagem clara para a tela. */
export function toGitError(error: ExecFailure, stderr: string, cwd: string): Error {
  const detail = stderr.trim() || error.message;
  if (error.code === 'ENOENT') {
    // O Node também dá ENOENT quando a pasta de trabalho não existe, não só quando falta o Git.
    return folderExists(cwd) ? new GitNotFoundError('O Git não foi encontrado neste computador.') : new GitError('folderMissing', detail);
  }
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new GitError('tooLarge', detail);
  if (error.killed) return new GitError('timeout', detail);
  if (/dubious ownership|safe\.directory/i.test(stderr)) return new GitError('unsafe', detail);
  return new GitError('failed', detail);
}

function folderExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

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
  throw new GitNotFoundError('O Git não foi encontrado neste computador.');
}

/** Tempo máximo de um comando do Git. Um Git travado (pasta de rede, disco lento) não prende as telas. */
const GIT_TIMEOUT = 30_000;

interface GitOptions {
  /** Prazo próprio, em milissegundos (padrão: GIT_TIMEOUT). */
  timeout?: number;
  /** Variáveis de ambiente a mais para este comando. */
  env?: Record<string, string>;
}

/** Executa o Git pelo caminho absoluto. Usa execFile (sem shell), então nada é interpretado como comando. */
function git(gitPath: string, cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  if (!isAbsolute(gitPath)) {
    return Promise.reject(new GitNotFoundError('O caminho do Git precisa ser absoluto.'));
  }
  return new Promise((resolve, reject) => {
    execFile(
      gitPath,
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
        timeout: options.timeout ?? GIT_TIMEOUT,
        // Nunca pedir usuário/senha num terminal que ninguém vê (o comando ficaria parado esperando).
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(toGitError(error, stderr, cwd));
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

/** Respostas do Git (em inglês) para uma pasta que não é um projeto com Git. */
const NOT_A_REPO = /not a git repository|must be run in a work tree/i;

/** Descobre a raiz do repositório a partir de uma pasta qualquer dentro dele. */
export async function findRepo(gitPath: string, folder: string): Promise<Repo> {
  let root: string;
  try {
    // LC_ALL=C: a mensagem do Git sai sempre em inglês, para reconhecermos "não é um repositório".
    root = (await git(gitPath, folder, ['rev-parse', '--show-toplevel'], { env: { LC_ALL: 'C' } })).trim();
  } catch (error) {
    // Só é "pasta sem Git" quando o Git diz isso. Pasta bloqueada por segurança, pasta que sumiu
    // ou Git travado têm mensagens próprias.
    if (error instanceof GitError && error.kind === 'failed' && NOT_A_REPO.test(error.detail)) {
      throw new NotARepoError('Esta pasta não é um repositório Git.');
    }
    throw error;
  }
  return { root, name: basename(root), gitPath };
}

export interface CommitPage {
  commits: Commit[];
  hasMore: boolean;
}

/**
 * O que pode ir na lista de pontos de partida do `git log`: HEAD ou um nome completo de branch.
 * Começar por "refs/" já impede que vire uma opção; recusamos só espaço ASCII e caracteres de controle,
 * porque o Git aceita outros espaços Unicode (ex.: NBSP) em nomes de branch.
 */
const REVISION = /^(HEAD|refs\/(heads|remotes)\/[^\x00-\x20\x7f]+)$/;

/**
 * Lê uma "página" de commits.
 * Sem `revisions`: todas as branches, tags e remotos, e o HEAD.
 * Com `revisions`: só o histórico que leva a elas (ex.: ["HEAD", "refs/heads/main"]).
 */
export async function readCommits(repo: Repo, skip: number, limit: number, revisions?: string[]): Promise<CommitPage> {
  if (revisions && (revisions.length === 0 || !revisions.every((r) => REVISION.test(r)))) {
    throw new Error('Filtro de branches inválido.');
  }
  const raw = await git(repo.gitPath, repo.root, [
    '-c', 'core.quotepath=off',
    '-c', 'i18n.logOutputEncoding=UTF-8',
    // Quem assina commits pode ter isto ligado; a verificação da assinatura se misturaria à saída.
    '-c', 'log.showSignature=false',
    'log',
    '-z',
    '--date-order',
    '--decorate=full',
    `--format=${LOG_FORMAT}`,
    `--skip=${skip}`,
    // Pedimos um a mais só para saber se ainda existem commits depois desta página.
    `--max-count=${limit + 1}`,
    // Um ponto de partida que ainda não tem commit (repositório vazio, branch órfã recém-criada)
    // é ignorado em vez de dar "bad revision".
    '--ignore-missing',
    // "Todas" = branches, tags, remotos e o HEAD (que pode estar solto). Não usamos --all porque ele
    // também traz refs internas (stash, notes, backups do filter-branch, prefetch...).
    ...(revisions ?? ['--branches', '--tags', '--remotes', 'HEAD']),
    // O "--" no final garante que os nomes nunca sejam confundidos com arquivos.
    '--',
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

/** Todas as branches locais e do servidor, e qual é a padrão do servidor. */
export async function readBranches(repo: Repo): Promise<BranchList> {
  const raw = await git(repo.gitPath, repo.root, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']);
  return parseBranches(raw);
}

/** Compara uma ponta de branch com a principal: quantos commits ela tem a mais e a menos. */
export async function readBranchStatus(repo: Repo, baseHash: string, tipHash: string): Promise<BranchStatus> {
  if (!isCommitHash(baseHash) || !isCommitHash(tipHash)) throw new Error('Commit inválido.');
  const raw = await git(repo.gitPath, repo.root, ['rev-list', '--left-right', '--count', `${baseHash}...${tipHash}`]);
  const [behind = 0, ahead = 0] = raw.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

/** Máximo de branches listadas em "este commit aparece em". */
const MAX_PLACEMENT_BRANCHES = 20;
const PLACEMENT_TIMEOUT = 10_000;

/** Em quais branches um commit aparece e se ele já está na branch principal. */
export async function readCommitPlacement(repo: Repo, hash: string): Promise<CommitPlacement> {
  if (!isCommitHash(hash)) throw new Error('Commit inválido.');
  const [list, contains] = await Promise.all([
    readBranches(repo),
    // É o comando mais lento dos detalhes em projetos com muitas branches, e só um extra: prazo curto.
    git(repo.gitPath, repo.root, ['for-each-ref', '--contains', hash, '--format=%(refname)', 'refs/heads', 'refs/remotes'], {
      timeout: PLACEMENT_TIMEOUT,
    }),
  ]);
  const base = pickBase(list);
  const refs = new Set(contains.split(/\r?\n/).filter(Boolean));
  // A ordem segue a lista de branches: primeiro as locais, depois as do servidor.
  const found = list.branches.filter((b) => refs.has(b.ref));
  return {
    baseName: base?.name ?? null,
    inBase: base ? refs.has(base.ref) : false,
    branches: found.slice(0, MAX_PLACEMENT_BRANCHES).map((b) => ({ name: b.name, type: b.type, ...(b.current ? { current: true } : {}) })),
    totalBranches: found.length,
  };
}

/** Pastas internas do Git: `gitDir` (onde fica o HEAD) e `commonDir` (onde ficam as refs). */
export async function readGitDirs(repo: Repo): Promise<{ gitDir: string; commonDir: string }> {
  const raw = await git(repo.gitPath, repo.root, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
  const [gitDir = '', commonDir = ''] = raw.split(/\r?\n/);
  return { gitDir: gitDir.trim(), commonDir: (commonDir || gitDir).trim() };
}

/** O que existe num caminho dentro de um commit. `type` "commit" = submódulo (outro repositório dentro deste). */
export interface TreeEntry {
  type: 'blob' | 'tree' | 'commit';
  hash: string;
}

/** Lê o que está em `path` no commit `hash` (ou `null` se não existir nada nesse caminho). */
export async function readTreeEntry(repo: Repo, hash: string, path: string): Promise<TreeEntry | null> {
  if (!isCommitHash(hash)) throw new Error('Commit inválido.');
  // --literal-pathspecs: o caminho é só um nome de arquivo (sem curingas nem ":(...)").
  const raw = await git(repo.gitPath, repo.root, ['--literal-pathspecs', 'ls-tree', '-z', `${hash}^{commit}`, '--', path]);
  for (const record of raw.split('\0')) {
    const match = /^\d{6} (blob|tree|commit) ([0-9a-f]{40,64})\t(.*)$/s.exec(record);
    if (match && match[3] === path) return { type: match[1] as TreeEntry['type'], hash: match[2] as string };
  }
  return null;
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
    '-c', 'log.showSignature=false',
    // "^{commit}": o Git recusa qualquer objeto que não seja um commit (arquivo, pasta, tag...).
    // O "--" garante que o hash nunca seja lido como nome de arquivo.
    // "--no-renames": mesmo com -s o `show` procura renomeações, e isso lê o conteúdo dos arquivos
    // (num clone parcial sem internet, falharia).
    'show', '-s', '--no-renames', '--decorate=full', `--format=${SHOW_FORMAT}`, `${hash}^{commit}`, '--',
  ]);
  // O parseShow só aceita hash e pais que sejam hashes completos.
  const info = parseShow(show);
  if (!info) throw new Error('Não foi possível ler este commit.');

  const comparedTo = info.parents[0] ?? null;
  // Primeiro commit: compara com "nada" (--root). Merges: compara com o primeiro pai.
  const range = comparedTo ? [comparedTo, info.hash, '--'] : ['--root', info.hash, '--'];
  const diffTree = (...options: string[]) =>
    git(repo.gitPath, repo.root, ['-c', 'core.quotepath=off', 'diff-tree', '-r', '-z', '--no-commit-id', ...options, ...range]);
  // Contar linhas (--numstat) e achar renomeações com mudança (-M) exigem o conteúdo dos arquivos.
  // Num clone parcial sem internet esse conteúdo pode não estar no computador: aí mostramos os
  // arquivos sem a contagem e, se preciso, sem juntar as renomeações, em vez de falhar.
  const [withRenames, numstat, placement] = await Promise.all([
    diffTree('-M', '--name-status').catch(() => null),
    diffTree('-M', '--numstat').catch(() => ''),
    // Saber onde o commit está é um extra: se falhar, os detalhes aparecem do mesmo jeito.
    readCommitPlacement(repo, info.hash).catch(() => null),
  ]);
  const nameStatus = withRenames ?? (await diffTree('--name-status'));
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
    placement,
  };
}
