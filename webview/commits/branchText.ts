// Textos sobre branches em linguagem simples. Separado da tela para poder ser testado.
import type { Commit, CommitFilter, RepoOverview } from '../../src/shared/protocol.ts';
import { formatCount, isolate, plural } from '../shared/format.ts';

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

/**
 * Rótulo da opção "minha branch" do filtro. Os nomes vêm do repositório: passam por `isolate`
 * (caracteres de direção visíveis e nome isolado do resto da frase).
 */
export function currentOptionLabel(head: string | null, baseName: string | null): string {
  if (!head) return baseName ? `Este commit e a ${isolate(baseName)}` : 'Só este commit';
  if (!baseName || head === baseName) return `Só a minha branch (${isolate(head)})`;
  return `Minha branch (${isolate(head)}) e a ${isolate(baseName)}`;
}

/**
 * Explicação do "N fora da main" depois de um "Squash and merge"/"Rebase and merge": o número não
 * zera, porque as mudanças entraram na principal como commits novos. `baseName` já isolado.
 */
function squashNote(baseName: string): string {
  return `Se ela já foi juntada pelo GitHub com "Squash" ou "Rebase", esse número não zera: as mudanças entraram na ${baseName} como commits novos.`;
}

/** Etiqueta curta na ponta de uma branch com commits que ainda não estão na principal. */
export function aheadBadge(commit: Commit, overview: RepoOverview | undefined): { text: string; title: string } | null {
  const base = overview?.base;
  if (!base || commit.hash === base.hash) return null;
  if (!commit.refs.some((r) => r.type === 'branch' || r.type === 'remote')) return null;
  const ahead = overview.status[commit.hash]?.ahead ?? 0;
  if (ahead <= 0) return null;
  const baseName = isolate(base.name);
  return {
    text: `${formatCount(ahead)} fora da ${baseName}`,
    title: `${plural(ahead, 'commit', 'commits')} desta branch ainda não ${ahead === 1 ? 'está' : 'estão'} na ${baseName}. ${squashNote(baseName)}`,
  };
}

/**
 * Frases do topo sobre a branch atual em relação à principal. Vazio quando não há nada a dizer.
 * `aheadTip`: a dica do mouse da frase `ahead` (a explicação do Squash/Rebase, que ficaria longa na tela).
 */
export function currentBranchSummary(overview: RepoOverview | undefined): {
  ahead: string | null;
  aheadTip: string | null;
  behind: string | null;
} {
  const empty = { ahead: null, aheadTip: null, behind: null };
  const base = overview?.base;
  const current = overview?.branches.find((b) => b.current);
  if (!base || !current || current.ref === base.ref || current.hash === base.hash) return empty;
  const status = overview.status[current.hash];
  if (!status) return empty;
  const baseName = isolate(base.name);
  const ahead = status.ahead > 0;
  return {
    ahead: ahead
      ? `Sua branch tem ${plural(status.ahead, 'commit', 'commits')} que ainda não ${status.ahead === 1 ? 'está' : 'estão'} na ${baseName}.`
      : null,
    aheadTip: ahead ? squashNote(baseName) : null,
    behind:
      status.behind > 0
        ? `A ${baseName} tem ${plural(status.behind, 'commit novo', 'commits novos')} que sua branch ainda não tem.`
        : null,
  };
}

/**
 * A branch escolhida em "Mostrar" sumiu (apagada, ou removida por um "Buscar") e a extensão voltou a
 * lista para "todas": devolve o nome dela para o aviso; `null` em qualquer outro caso. Se a branch
 * ainda existe (o filtro voltou para "todas" por outro motivo), não há aviso: ela não sumiu.
 * O nome vem da lista de branches de antes (`previous`); sem ela, do próprio nome completo.
 */
export function lostBranchName(
  requested: CommitFilter,
  applied: CommitFilter,
  overview: RepoOverview | undefined,
  previous: RepoOverview | undefined,
): string | null {
  if (requested.kind !== 'branch' || applied.kind !== 'all') return null;
  if (overview?.branches.some((b) => b.ref === requested.ref)) return null;
  const known = previous?.branches.find((b) => b.ref === requested.ref);
  if (known) return known.name;
  for (const prefix of ['refs/heads/', 'refs/remotes/']) {
    if (requested.ref.startsWith(prefix)) return requested.ref.slice(prefix.length);
  }
  return requested.ref;
}
