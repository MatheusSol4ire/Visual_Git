// Textos sobre branches em linguagem simples. Separado da tela para poder ser testado.
import type { Commit, CommitFilter, RepoOverview } from '../../src/shared/protocol.ts';
import { plural } from '../shared/format.ts';

/** Valor do <select> do filtro. */
export function filterValue(filter: CommitFilter): string {
  if (filter.kind === 'branch') return `ref:${filter.ref}`;
  return filter.kind;
}

export function filterFromValue(value: string): CommitFilter {
  if (value.startsWith('ref:')) return { kind: 'branch', ref: value.slice(4) };
  if (value === 'current') return { kind: 'current' };
  return { kind: 'all' };
}

export function sameFilter(a: CommitFilter, b: CommitFilter): boolean {
  return filterValue(a) === filterValue(b);
}

/** Lê o filtro salvo pela tela, aceitando só formatos conhecidos. */
export function parseSavedFilter(saved: unknown): CommitFilter {
  const filter = (saved as { filter?: Partial<CommitFilter> } | null | undefined)?.filter;
  if (filter?.kind === 'current') return { kind: 'current' };
  if (filter?.kind === 'branch' && typeof filter.ref === 'string') return { kind: 'branch', ref: filter.ref };
  return { kind: 'all' };
}

/** Rótulo da opção "minha branch" do filtro. */
export function currentOptionLabel(head: string | null, baseName: string | null): string {
  if (!head) return baseName ? `O commit atual e a ${baseName}` : 'Só o commit atual';
  if (!baseName || head === baseName) return `Só a minha branch (${head})`;
  return `Minha branch (${head}) e a ${baseName}`;
}

/** Etiqueta curta na ponta de uma branch com commits que ainda não estão na principal. */
export function aheadBadge(commit: Commit, overview: RepoOverview | undefined): { text: string; title: string } | null {
  const base = overview?.base;
  if (!base || commit.hash === base.hash) return null;
  if (!commit.refs.some((r) => r.type === 'branch' || r.type === 'remote')) return null;
  const ahead = overview.status[commit.hash]?.ahead ?? 0;
  if (ahead <= 0) return null;
  return {
    text: `${ahead} fora da ${base.name}`,
    title: `${plural(ahead, 'commit', 'commits')} desta branch ainda não ${ahead === 1 ? 'está' : 'estão'} na ${base.name}`,
  };
}

/** Frases do topo sobre a branch atual em relação à principal. Vazio quando não há nada a dizer. */
export function currentBranchSummary(overview: RepoOverview | undefined): { ahead: string | null; behind: string | null } {
  const empty = { ahead: null, behind: null };
  const base = overview?.base;
  const current = overview?.branches.find((b) => b.current);
  if (!base || !current || current.ref === base.ref || current.hash === base.hash) return empty;
  const status = overview.status[current.hash];
  if (!status) return empty;
  return {
    ahead:
      status.ahead > 0
        ? `Sua branch tem ${plural(status.ahead, 'commit', 'commits')} que ainda não ${status.ahead === 1 ? 'está' : 'estão'} na ${base.name}.`
        : null,
    behind:
      status.behind > 0
        ? `A ${base.name} tem ${plural(status.behind, 'commit novo', 'commits novos')} que sua branch ainda não tem.`
        : null,
  };
}
