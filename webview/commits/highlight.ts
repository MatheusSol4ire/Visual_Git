// Destaque do caminho de uma branch na lista: qual etiqueta está destacada e como ela acompanha
// as listas novas. Separado da tela para poder ser testado.
import type { Commit, Ref } from '../../src/shared/protocol.ts';
import { ancestorsOf } from '../graph/layout.ts';

/**
 * Branch destacada: o commit da etiqueta, o nome mostrado no aviso e o tipo da etiqueta
 * (uma tag e uma branch podem ter o mesmo nome, ex.: "1.0").
 */
export interface Highlight {
  hash: string;
  name: string;
  type: Ref['type'];
}

/** Se é a mesma etiqueta (mesmo nome e mesmo tipo). */
export function sameRef(a: Pick<Ref, 'name' | 'type'>, b: Pick<Ref, 'name' | 'type'>): boolean {
  return a.name === b.name && a.type === b.type;
}

/**
 * A cada lista nova, o destaque fixo segue a etiqueta: se a branch ganhou commits ele vai para a
 * ponta nova; se a etiqueta sumiu da lista, o destaque é desligado (`null`).
 */
export function followPinned(current: Highlight | null, commits: Commit[]): Highlight | null {
  if (!current) return current;
  const tip = commits.find((c) => c.refs.some((r) => sameRef(r, current)));
  if (!tip) return null;
  return tip.hash === current.hash ? current : { ...current, hash: tip.hash };
}

/**
 * A prévia (mouse sobre uma etiqueta) só continua se a etiqueta ainda estiver no mesmo commit.
 * Uma recarga pode tirar da tela a etiqueta sob o mouse sem o navegador avisar (`mouseleave`).
 */
export function keepPreview(current: Highlight | null, commits: Commit[]): Highlight | null {
  if (!current) return current;
  const commit = commits.find((c) => c.hash === current.hash);
  return commit?.refs.some((r) => sameRef(r, current)) ? current : null;
}

/** Commits do caminho destacado; `null` = sem destaque (inclusive se o commit não está na lista). */
export function litCommits(highlight: Highlight | null, commits: Commit[]): Set<string> | null {
  if (!highlight) return null;
  const lit = ancestorsOf(highlight.hash, commits);
  return lit.size > 0 ? lit : null;
}
