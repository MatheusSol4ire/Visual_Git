// O que as telas guardam com setState. Sem `retainContextWhenHidden`, o VS Code destrói a tela
// escondida e a recria do zero ao voltar; com isto ela volta como estava.
// Separado das telas para poder ser testado.
import type { CommitFilter } from '../../src/shared/protocol.ts';
import { parseSavedFilter } from '../commits/branchText.ts';
import type { Highlight } from '../commits/highlight.ts';

/** O que a lista de commits guarda. */
export interface SavedList {
  filter: CommitFilter;
  /**
   * Último número de pedido usado. A tela recriada continua depois dele, para nunca aceitar
   * respostas de pedidos feitos pela tela antiga. `null` se ainda não houve nenhum.
   */
  gen: number | null;
  /** Commit selecionado. */
  selected: string | null;
  /** Branch destacada (o commit da etiqueta, o nome e o tipo dela). */
  pinned: Highlight | null;
  /** Posição da rolagem, em pixels. */
  scrollTop: number;
  /** Quantos commits estavam carregados (para a rolagem caber de novo). */
  count: number;
}

/** O que a aba de detalhes guarda. */
export interface SavedDetails {
  /** Commit que estava aberto. */
  hash: string | null;
  scrollTop: number;
}

const HASH = /^[0-9a-f]{4,64}$/i;
const REF_TYPES: readonly unknown[] = ['branch', 'remote', 'tag', 'head'] satisfies Highlight['type'][];

const hashOrNull = (value: unknown): string | null => (typeof value === 'string' && HASH.test(value) ? value : null);
const nonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Lê o estado salvo da lista, aceitando só formatos conhecidos (qualquer outra coisa vira o padrão). */
export function parseSavedList(saved: unknown): SavedList {
  const raw = (saved ?? {}) as Partial<Record<keyof SavedList, unknown>>;
  const pinned = raw.pinned as { hash?: unknown; name?: unknown; type?: unknown } | null | undefined;
  return {
    filter: parseSavedFilter(saved),
    gen: Number.isSafeInteger(raw.gen) ? (raw.gen as number) : null,
    selected: hashOrNull(raw.selected),
    pinned:
      pinned && hashOrNull(pinned.hash) && typeof pinned.name === 'string' && pinned.name && REF_TYPES.includes(pinned.type)
        ? { hash: pinned.hash as string, name: pinned.name, type: pinned.type as Highlight['type'] }
        : null,
    scrollTop: nonNegative(raw.scrollTop),
    count: nonNegative(raw.count),
  };
}

/** Primeiro número de pedido da tela: logo depois do último usado, ou um sorteado se não houver. */
export function firstGen(saved: SavedList, random: () => number = Math.random): number {
  if (saved.gen !== null && saved.gen < Number.MAX_SAFE_INTEGER) return saved.gen + 1;
  return Math.floor(random() * 1_000_000_000);
}

export function parseSavedDetails(saved: unknown): SavedDetails {
  const raw = (saved ?? {}) as Partial<Record<keyof SavedDetails, unknown>>;
  return { hash: hashOrNull(raw.hash), scrollTop: nonNegative(raw.scrollTop) };
}
