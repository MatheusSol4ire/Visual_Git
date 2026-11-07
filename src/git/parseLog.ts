import type { Commit, Ref } from '../shared/protocol.ts';

// O separador é o NUL: o Git nunca o coloca em nomes, e-mails ou mensagens, então nenhum texto
// vindo do repositório consegue "fingir" um campo ou um commit a mais.
const FIELD = '\0';
const FIELD_COUNT = 7;

/**
 * Formato passado ao `git log -z --format=...`. A ordem precisa bater com `parseLog`.
 * Com `-z`, o Git também termina cada commit com um NUL, então cada commit ocupa sempre 7 campos.
 */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s'].join('%x00');

/** Hash completo de commit (SHA-1 com 40 dígitos ou SHA-256 com 64). */
const FULL_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isFullHash(value: string): boolean {
  return FULL_HASH.test(value);
}

/** Lê o campo %P ("pai1 pai2"). Devolve `undefined` se algum item não for um hash de verdade. */
export function parseParents(value: string): string[] | undefined {
  const parents = value.split(' ').filter(Boolean);
  return parents.every(isFullHash) ? parents : undefined;
}

/** Converte a saída de `git log -z --decorate=full --format=LOG_FORMAT` em commits. */
export function parseLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  const fields = raw.split(FIELD);
  for (let i = 0; i + FIELD_COUNT <= fields.length; i += FIELD_COUNT) {
    const [hash = '', parentList = '', authorName = '', authorEmail = '', date = '', decorations = '', subject = ''] =
      fields.slice(i, i + FIELD_COUNT);
    // Registros com hash ou pais estranhos são descartados: nunca chegam ao grafo nem aos detalhes.
    const parents = parseParents(parentList);
    if (!isFullHash(hash) || !parents) continue;

    commits.push({
      hash,
      parents,
      authorName,
      authorEmail,
      date,
      subject,
      refs: parseRefs(decorations),
    });
  }
  return commits;
}

/**
 * Lê o campo %D com nomes completos (graças ao --decorate=full), ex.:
 * "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0"
 */
export function parseRefs(decorations: string): Ref[] {
  const refs: Ref[] = [];
  for (const piece of decorations.split(', ')) {
    const item = piece.trim();
    if (!item) continue;

    if (item === 'HEAD') {
      // HEAD "solto" (detached): apontando direto para um commit, sem branch.
      refs.push({ name: 'HEAD', type: 'head' });
      continue;
    }
    if (item.startsWith('HEAD -> ')) {
      const ref = classify(item.slice('HEAD -> '.length));
      if (ref) refs.push({ ...ref, current: true });
      continue;
    }
    if (item.startsWith('tag: ')) {
      const ref = classify(item.slice('tag: '.length));
      if (ref) refs.push(ref);
      continue;
    }
    const ref = classify(item);
    if (ref) refs.push(ref);
  }
  return refs;
}

function classify(fullName: string): Ref | undefined {
  if (fullName.startsWith('refs/heads/')) {
    return { name: fullName.slice('refs/heads/'.length), type: 'branch' };
  }
  if (fullName.startsWith('refs/remotes/')) {
    const name = fullName.slice('refs/remotes/'.length);
    // "origin/HEAD" só diz qual é a branch padrão do remoto; não vale mostrar.
    if (name.endsWith('/HEAD')) return undefined;
    return { name, type: 'remote' };
  }
  if (fullName.startsWith('refs/tags/')) {
    return { name: fullName.slice('refs/tags/'.length), type: 'tag' };
  }
  // Outros tipos (ex.: refs/stash, refs/notes) ficam de fora por enquanto.
  return undefined;
}
