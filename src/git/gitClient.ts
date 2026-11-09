import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import { LOG_FORMAT, parseLog } from './parseLog.ts';
import { parseDiffTree, parseShow, SHOW_FORMAT } from './parseDetails.ts';
import { BRANCH_FORMAT, parseBranches, pickBase, type BranchList } from './branches.ts';
import type { BranchStatus, Commit, CommitDetails, CommitPlacement } from '../shared/protocol.ts';

export class GitNotFoundError extends Error {}
export class NotARepoError extends Error {}

export type GitErrorKind = 'failed' | 'timeout' | 'tooLarge' | 'folderMissing' | 'unsafe' | 'cancelled';

/** Mensagens mostradas na tela: em português, sem jargão, dizendo o que fazer. */
const GIT_ERROR_MESSAGES: Record<GitErrorKind, string> = {
  failed: 'O Git não conseguiu ler as informações do projeto. Os detalhes técnicos estão em Saída › Visual Git.',
  timeout: 'O Git demorou demais para responder e a leitura foi cancelada. Tente de novo daqui a pouco.',
  tooLarge: 'Há informação demais para mostrar de uma vez.',
  // Só acontece quando a leitura não é mais necessária (outro pedido tomou o lugar); a tela nem a recebe.
  cancelled: 'A leitura foi cancelada.',
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
  if (error.code === 'ABORT_ERR') return new GitError('cancelled', detail);
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
 * Pelo mesmo motivo, um Git que fica (de verdade, seguindo atalhos/links) dentro de uma das
 * `projectFolders` é recusado: o PATH pode incluir uma pasta do projeto (ex.: um ambiente virtual
 * ativado, ou o "PATH_add bin" do direnv) e o projeto poderia trazer o seu próprio "git".
 */
export function findGitInPath(env: NodeJS.ProcessEnv = process.env, projectFolders: readonly string[] = []): string {
  const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
  const pathValue = env.PATH ?? env.Path ?? '';
  const projects = projectFolders.map(realPathOrSelf);
  for (const dir of pathValue.split(delimiter)) {
    const clean = dir.trim().replace(/^"(.*)"$/, '$1');
    if (!clean || !isAbsolute(clean)) continue; // entradas relativas apontariam para a pasta atual
    for (const name of names) {
      const candidate = join(clean, name);
      try {
        if (!statSync(candidate).isFile()) continue;
      } catch {
        continue; // não existe nesta pasta; segue procurando
      }
      const real = realPathOrSelf(candidate);
      if (projects.some((folder) => isInside(real, folder))) continue; // Git trazido pelo projeto: ignora
      return candidate;
    }
  }
  throw new GitNotFoundError('O Git não foi encontrado neste computador.');
}

/** Caminho real (sem atalhos/links), ou o próprio caminho se não der para resolver. */
function realPathOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** true quando `path` é `folder` ou fica dentro dela (sem diferenciar maiúsculas no Windows/macOS). */
export function isInside(path: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const lib = platform === 'win32' ? win32 : posix;
  const fold = (value: string) => {
    const resolved = lib.resolve(value);
    return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
  };
  const rel = lib.relative(fold(folder), fold(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${lib.sep}`) && !lib.isAbsolute(rel));
}

/** true quando os dois caminhos são a mesma pasta (sem diferenciar maiúsculas no Windows/macOS). */
function samePath(a: string, b: string): boolean {
  return isInside(a, b) && isInside(b, a);
}

/** Tempo máximo de um comando do Git. Um Git travado (pasta de rede, disco lento) não prende as telas. */
const GIT_TIMEOUT = 30_000;

interface GitOptions {
  /** Prazo próprio, em milissegundos (padrão: GIT_TIMEOUT). */
  timeout?: number;
  /** Variáveis de ambiente a mais para este comando. */
  env?: Record<string, string>;
  /** Cancela o comando (o processo do Git é encerrado). */
  signal?: AbortSignal;
}

/** Executa o Git pelo caminho absoluto. Usa execFile (sem shell), então nada é interpretado como comando. */
function git(gitPath: string, cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  if (!isAbsolute(gitPath)) {
    return Promise.reject(new GitNotFoundError('O caminho do Git precisa ser absoluto.'));
  }
  // Já cancelado: nem abre o processo.
  if (options.signal?.aborted) return Promise.reject(new GitError('cancelled'));
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
        ...(options.signal ? { signal: options.signal } : {}),
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
  /** Pastas internas do Git, quando já vieram junto com a raiz (ver `readGitDirs`). */
  dirs?: { gitDir: string; commonDir: string };
}

/** Respostas do Git (em inglês) para uma pasta que não é um projeto com Git. */
const NOT_A_REPO = /not a git repository|must be run in a work tree/i;

/** Descobre a raiz do repositório a partir de uma pasta qualquer dentro dele. */
export async function findRepo(gitPath: string, folder: string): Promise<Repo> {
  // LC_ALL=C: a mensagem do Git sai sempre em inglês, para reconhecermos "não é um repositório".
  const run = (args: string[]) => git(gitPath, folder, ['rev-parse', ...args], { env: { LC_ALL: 'C' } });
  try {
    // Um processo só traz a raiz e as pastas internas (que o RepoService observa).
    const found = parseRepoDirs(await run(['--show-toplevel', '--git-dir', '--git-common-dir']), folder);
    if (found) return { root: found.root, name: repoName(found.root), gitPath, ...(found.dirs ? { dirs: found.dirs } : {}) };
    // Saída inesperada (ex.: quebra de linha no nome da pasta): só a raiz, como antes.
    // Só a quebra de linha do fim sai: no Linux/macOS uma pasta pode terminar em espaço ("meu projeto ").
    const root = (await run(['--show-toplevel'])).replace(/\r?\n$/, '');
    return { root, name: repoName(root), gitPath };
  } catch (error) {
    // Só é "pasta sem Git" quando o Git diz isso. Pasta bloqueada por segurança, pasta que sumiu
    // ou Git travado têm mensagens próprias.
    if (error instanceof GitError && error.kind === 'failed' && NOT_A_REPO.test(error.detail)) {
      throw new NotARepoError('Esta pasta não é um repositório Git.');
    }
    throw error;
  }
}

/**
 * Lê a saída de `git rev-parse --show-toplevel --git-dir --git-common-dir` rodado em `folder`.
 * `undefined` quando a saída não tem exatamente 3 linhas (aí quem chama pergunta só a raiz).
 * As pastas internas só são usadas quando não há dúvida de onde elas ficam. Numa subpasta, um Git
 * anterior ao 2.13 dava o --git-common-dir relativo à raiz e não à pasta (".git" em vez de "../.git");
 * nesse caso `dirs` fica de fora e `readGitDirs` pergunta de novo, a partir da raiz.
 */
export function parseRepoDirs(
  raw: string,
  folder: string,
): { root: string; dirs?: { gitDir: string; commonDir: string } } | undefined {
  const lines = raw.replace(/\r?\n$/, '').split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length !== 3) return undefined;
  const [root = '', gitLine = '', commonLine = ''] = lines;
  if (!root || !isAbsolute(root)) return undefined;
  const dirs = parseGitDirs(`${gitLine}\n${commonLine}\n`, folder);
  if (!dirs) return { root };
  // Na própria raiz, relativo à pasta = relativo à raiz: não há dúvida.
  if (samePath(root, folder)) return { root, dirs };
  // Numa subpasta o Git dá a gitDir absoluta. A pasta comum vale se veio absoluta, se não veio
  // (Git < 2.5: é a própria gitDir) ou se, resolvida a partir da subpasta, dá na própria gitDir
  // (o caso comum: "../.git"). Senão pode ser o jeito antigo, relativo à raiz.
  const commonOk = isAbsolute(commonLine) || commonLine.startsWith('-') || samePath(dirs.commonDir, dirs.gitDir);
  return isAbsolute(gitLine) && commonOk ? { root, dirs } : { root };
}

/** Nome mostrado do projeto: o da pasta, ou o próprio caminho quando é a raiz de um disco ("E:/"). */
export function repoName(root: string): string {
  return basename(root) || root;
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

/** Maior `skip` aceito: o Git lê `--skip` como inteiro de 32 bits. */
export const MAX_SKIP = 2 ** 31 - 1;
/** Maior página aceita (pedimos `limit + 1` ao Git, que também precisa caber em 32 bits). */
export const MAX_LIMIT = 10_000;

/**
 * Lê uma "página" de commits.
 * Sem `revisions`: todas as branches, tags e remotos, e o HEAD.
 * Com `revisions`: só o histórico que leva a elas (ex.: ["HEAD", "refs/heads/main"]).
 */
export async function readCommits(
  repo: Repo,
  skip: number,
  limit: number,
  revisions?: string[],
  signal?: AbortSignal,
): Promise<CommitPage> {
  if (revisions && (revisions.length === 0 || !revisions.every((r) => REVISION.test(r)))) {
    throw new Error('Filtro de branches inválido.');
  }
  // O Git só aceita inteiros de 32 bits aqui; acima disso ele aborta com "not an integer".
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > MAX_SKIP) throw new Error('Posição inválida na lista de commits.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error('Quantidade de commits inválida.');
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
  ], { signal });
  const commits = parseLog(raw);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

/**
 * Nome da branch atual, ou `null` se o HEAD estiver solto (detached).
 * Vale também para uma branch que ainda não tem commits (repositório vazio, `git switch --orphan`).
 */
export async function readHead(repo: Repo, signal?: AbortSignal): Promise<string | null> {
  try {
    // Sem --short: com uma tag de mesmo nome, o Git "encurtaria" para "heads/main". Cortamos o
    // "refs/heads/" nós mesmos, como em parseBranches.
    const ref = (await git(repo.gitPath, repo.root, ['symbolic-ref', '--quiet', 'HEAD'], { signal })).replace(/\r?\n$/, '');
    return ref.startsWith('refs/heads/') && ref.length > 'refs/heads/'.length ? ref.slice('refs/heads/'.length) : null;
  } catch {
    return null;
  }
}

/** Todas as branches locais e do servidor, e qual é a padrão do servidor. */
export async function readBranches(repo: Repo, signal?: AbortSignal): Promise<BranchList> {
  const raw = await git(repo.gitPath, repo.root, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes'], { signal });
  return parseBranches(raw);
}

/** Compara uma ponta de branch com a principal: quantos commits ela tem a mais e a menos. */
export async function readBranchStatus(repo: Repo, baseHash: string, tipHash: string): Promise<BranchStatus> {
  if (!isCommitHash(baseHash) || !isCommitHash(tipHash)) throw new Error('Commit inválido.');
  const raw = await git(repo.gitPath, repo.root, ['rev-list', '--left-right', '--count', `${baseHash}...${tipHash}`]);
  const [behind = 0, ahead = 0] = raw.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

/** Executáveis do Git que já mostraram não ter o `%(ahead-behind:)` (Git anterior ao 2.41). */
const noAheadBehind = new Set<string>();

/**
 * Compara TODAS as pontas de branch com a principal num comando só (`%(ahead-behind:)`, Git ≥ 2.41):
 * uma caminhada pelo histórico em vez de um `rev-list` por branch.
 * Devolve `undefined` quando o Git é antigo demais; aí quem chama usa `readBranchStatus` por branch.
 * O resultado vem por hash da ponta (várias branches na mesma ponta têm o mesmo status).
 */
export async function readAllBranchStatus(repo: Repo, baseHash: string): Promise<Map<string, BranchStatus> | undefined> {
  if (!isCommitHash(baseHash)) throw new Error('Commit inválido.');
  if (noAheadBehind.has(repo.gitPath)) return undefined;
  let raw: string;
  try {
    raw = await git(
      repo.gitPath,
      repo.root,
      ['for-each-ref', `--format=%(objectname)%1f%(ahead-behind:${baseHash})`, 'refs/heads', 'refs/remotes'],
      // LC_ALL=C: para reconhecer a mensagem de campo desconhecido (o Git pode responder traduzido).
      { env: { LC_ALL: 'C' } },
    );
  } catch (error) {
    if (error instanceof GitError && error.kind === 'failed' && /unknown field name/i.test(error.detail)) {
      noAheadBehind.add(repo.gitPath); // não adianta tentar de novo com este Git
      return undefined;
    }
    throw error;
  }
  const result = new Map<string, BranchStatus>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64})\x1f(\d+) (\d+)$/.exec(line);
    if (match) result.set(match[1] as string, { ahead: Number(match[2]), behind: Number(match[3]) });
  }
  return result;
}

/** Máximo de branches listadas em "este commit aparece em". */
const MAX_PLACEMENT_BRANCHES = 20;
const PLACEMENT_TIMEOUT = 10_000;

/** Em quais branches um commit aparece e se ele já está na branch principal. */
export async function readCommitPlacement(repo: Repo, hash: string, signal?: AbortSignal): Promise<CommitPlacement> {
  if (!isCommitHash(hash)) throw new Error('Commit inválido.');
  const [list, contains] = await Promise.all([
    readBranches(repo, signal),
    // É o comando mais lento dos detalhes em projetos com muitas branches, e só um extra: prazo curto.
    git(repo.gitPath, repo.root, ['for-each-ref', '--contains', hash, '--format=%(refname)', 'refs/heads', 'refs/remotes'], {
      timeout: PLACEMENT_TIMEOUT,
      signal,
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
  // Quase sempre já vieram no mesmo `rev-parse` que achou a raiz (findRepo).
  if (repo.dirs) return repo.dirs;
  // Sem --path-format=absolute: ele só existe no Git 2.31+, e um Git mais antigo não dá erro — repete
  // a opção na saída e devolve caminhos relativos. Resolvemos nós mesmos a partir da raiz (o `cwd`).
  const raw = await git(repo.gitPath, repo.root, ['rev-parse', '--git-dir', '--git-common-dir']);
  const dirs = parseGitDirs(raw, repo.root);
  if (!dirs) throw new GitError('failed', `rev-parse devolveu: ${raw}`);
  return dirs;
}

/**
 * Lê a saída de `git rev-parse --git-dir --git-common-dir` rodado na raiz `root`.
 * Caminhos relativos (ex.: ".git") são resolvidos a partir da raiz. Uma linha que começa com "-" é uma
 * opção que o Git não conhece e repetiu (Git anterior ao 2.5 não tem --git-common-dir): aí a pasta
 * comum é a própria `gitDir`.
 */
export function parseGitDirs(raw: string, root: string): { gitDir: string; commonDir: string } | undefined {
  // Só a quebra de linha sai: espaço no fim pode ser parte do nome da pasta.
  const [gitLine = '', commonLine = ''] = raw.split('\n').map((line) => line.replace(/\r$/, ''));
  const usable = (line: string) => line !== '' && !line.startsWith('-');
  if (!usable(gitLine)) return undefined;
  const gitDir = resolve(root, gitLine);
  return { gitDir, commonDir: usable(commonLine) ? resolve(root, commonLine) : gitDir };
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

/**
 * Acima disto, as linhas (+/−) não são contadas: contar lê o conteúdo de cada arquivo, e num commit
 * com 10 mil arquivos isso passa de 1 s (medido) só para mostrar 500. Com 1000 o custo fica na casa
 * de 0,1 s. Uma renomeação conta como dois arquivos nessa conta (sai e entra), então um commit com
 * até 500 renomeações ainda tem as linhas contadas.
 */
export const MAX_COUNTED_FILES = 1000;

/** Detalhes de um commit: mensagem completa e arquivos alterados (comparados com o primeiro pai). */
/** `signal`: cancela a leitura (todos os processos do Git dela são encerrados). */
export async function readCommitDetails(repo: Repo, hash: string, signal?: AbortSignal): Promise<CommitDetails> {
  if (!isCommitHash(hash)) throw new Error('Commit inválido.');

  // Saber onde o commit está só depende do hash: começa junto com o `show`, sem esperar por ele.
  // É um extra: se falhar, os detalhes aparecem do mesmo jeito.
  const placement = readCommitPlacement(repo, hash, signal).catch(() => null);

  const show = await git(repo.gitPath, repo.root, [
    '-c', 'i18n.logOutputEncoding=UTF-8',
    '-c', 'log.showSignature=false',
    // "^{commit}": o Git recusa qualquer objeto que não seja um commit (arquivo, pasta, tag...).
    // O "--" garante que o hash nunca seja lido como nome de arquivo.
    // "--no-renames": mesmo com -s o `show` procura renomeações, e isso lê o conteúdo dos arquivos
    // (num clone parcial sem internet, falharia).
    'show', '-s', '--no-renames', '--decorate=full', `--format=${SHOW_FORMAT}`, `${hash}^{commit}`, '--',
  ], { signal });
  // O parseShow só aceita hash e pais que sejam hashes completos.
  const info = parseShow(show);
  if (!info) throw new Error('Não foi possível ler este commit.');

  const comparedTo = info.parents[0] ?? null;
  // Primeiro commit: compara com "nada" (--root). Merges: compara com o primeiro pai.
  const range = comparedTo ? [comparedTo, info.hash, '--'] : ['--root', info.hash, '--'];
  const diffTree = (options: string[], stop: AbortSignal | undefined = signal) =>
    git(repo.gitPath, repo.root, ['-c', 'core.quotepath=off', 'diff-tree', '-r', '-z', '--no-commit-id', ...options, ...range], {
      signal: stop,
    });

  // Um comando só traz o status (--raw) e as linhas contadas (--numstat): as renomeações (-M),
  // a parte cara, são procuradas uma vez.
  // Contar linhas lê o conteúdo de todos os arquivos: num commit gigante (ex.: node_modules enviado
  // sem querer) isso leva segundos. Por isso, ao mesmo tempo, uma contagem barata dos arquivos
  // (só compara as pastas, sem abrir arquivo) cancela a contagem de linhas se passar de MAX_COUNTED_FILES.
  const counting = new AbortController();
  // Cancelar a leitura inteira também cancela a contagem de linhas.
  const stopCounting = () => counting.abort();
  signal?.addEventListener('abort', stopCounting, { once: true });
  if (signal?.aborted) counting.abort();
  const [tooMany, full] = await Promise.all([
    diffTree(['--no-renames', '--name-only'])
      .then((raw) => {
        const many = countItems(raw) > MAX_COUNTED_FILES;
        if (many) counting.abort();
        return many;
      })
      .catch(() => false), // sem a contagem barata, segue com a completa
    diffTree(['-M', '--raw', '--numstat'], counting.signal).catch(() => null),
  ]);
  // Sem a contagem de linhas (commit gigante, ou clone parcial sem internet, onde o conteúdo dos
  // arquivos pode não estar no computador): só o status. Se nem as renomeações derem, sem juntá-las.
  const raw =
    (!tooMany ? full : null) ??
    (await diffTree(['-M', '--raw']).catch(() => null)) ??
    (await diffTree(['--no-renames', '--raw']));
  signal?.removeEventListener('abort', stopCounting);
  const counted = !tooMany && full !== null;
  const files = parseDiffTree(raw);
  // Somadas antes do corte em MAX_FILES: o cabeçalho da tela mostra o total do commit inteiro.
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions ?? 0;
    totalDeletions += file.deletions ?? 0;
  }

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
    totalAdditions,
    totalDeletions,
    comparedTo,
    placement: await placement,
    ...(counted ? {} : { uncounted: true as const }),
  };
}

/** Quantos itens há numa saída separada por NUL. */
function countItems(raw: string): number {
  let count = 0;
  for (const item of raw.split('\0')) if (item) count += 1;
  return count;
}
