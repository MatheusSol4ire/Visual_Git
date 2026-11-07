import type { BranchInfo, CommitFilter, RepoOverview } from '../shared/protocol.ts';

const FIELD = '\x1f';

/** Formato passado ao `git for-each-ref --format=...`. A ordem precisa bater com `parseBranches`. */
export const BRANCH_FORMAT = ['%(refname)', '%(objectname)', '%(symref)', '%(HEAD)'].join('%1f');

export interface BranchList {
  branches: BranchInfo[];
  /** Para onde o "origin/HEAD" aponta (a branch padrão do servidor), ex.: "refs/remotes/origin/main". */
  remoteDefault: string | null;
}

/** Converte a saída de `git for-each-ref --format=BRANCH_FORMAT refs/heads refs/remotes`. */
export function parseBranches(raw: string): BranchList {
  const branches: BranchInfo[] = [];
  let remoteDefault: string | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const [ref = '', hash = '', symref = '', head = ''] = line.split(FIELD);
    if (!/^[0-9a-f]{40,64}$/.test(hash)) continue;

    if (ref.startsWith('refs/heads/')) {
      branches.push({ ref, name: ref.slice('refs/heads/'.length), type: 'branch', hash, current: head === '*' });
    } else if (ref.startsWith('refs/remotes/')) {
      if (ref.endsWith('/HEAD')) {
        // "origin/HEAD" só diz qual é a branch padrão do servidor.
        if (ref === 'refs/remotes/origin/HEAD' && symref.startsWith('refs/remotes/origin/')) remoteDefault = symref;
        continue;
      }
      branches.push({ ref, name: ref.slice('refs/remotes/'.length), type: 'remote', hash, current: false });
    }
  }
  return { branches, remoteDefault };
}

/**
 * Escolhe a branch principal do projeto, a que fica fixa no primeiro trilho:
 * 1. a branch padrão do servidor (origin/HEAD), preferindo a cópia local dela;
 * 2. main ou master (local e, na falta, no servidor);
 * 3. a branch atual.
 */
export function pickBase({ branches, remoteDefault }: BranchList): RepoOverview['base'] {
  const byRef = new Map(branches.map((b) => [b.ref, b]));
  const candidates: string[] = [];

  if (remoteDefault) {
    const short = remoteDefault.slice('refs/remotes/origin/'.length);
    if (short) candidates.push(`refs/heads/${short}`);
    candidates.push(remoteDefault);
  }
  candidates.push('refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master');

  for (const ref of candidates) {
    const branch = byRef.get(ref);
    if (branch) return { name: branch.name, ref: branch.ref, hash: branch.hash };
  }
  const current = branches.find((b) => b.current);
  return current ? { name: current.name, ref: current.ref, hash: current.hash } : null;
}

/**
 * Transforma o filtro pedido pela tela nos pontos de partida do `git log`.
 * A tela só escolhe entre branches que existem de verdade; qualquer outra coisa vira "todas".
 */
export function resolveFilter(
  requested: unknown,
  list: BranchList,
  baseRef: string | null,
): { filter: CommitFilter; revisions: string[] | undefined } {
  const filter = requested as Partial<CommitFilter> | null | undefined;
  const withBase = (start: string) => (baseRef && baseRef !== start ? [start, baseRef] : [start]);

  // Sem nenhuma branch (ex.: projeto sem commits), não há o que filtrar.
  if (list.branches.length === 0) return { filter: { kind: 'all' }, revisions: undefined };
  if (filter?.kind === 'current') return { filter: { kind: 'current' }, revisions: withBase('HEAD') };
  if (filter?.kind === 'branch' && typeof filter.ref === 'string') {
    const branch = list.branches.find((b) => b.ref === filter.ref);
    if (branch) return { filter: { kind: 'branch', ref: branch.ref }, revisions: withBase(branch.ref) };
  }
  return { filter: { kind: 'all' }, revisions: undefined };
}

/** true quando `resolveFilter` manteve o filtro pedido (não voltou para "todas" porque a branch sumiu). */
export function keptFilter(requested: unknown, filter: CommitFilter): boolean {
  const asked = requested as Partial<CommitFilter> | null | undefined;
  if (filter.kind === 'branch') return asked?.kind === 'branch' && asked.ref === filter.ref;
  return asked?.kind === filter.kind;
}
