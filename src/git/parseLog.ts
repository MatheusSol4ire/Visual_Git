import type { Commit, Ref } from '../shared/protocol.ts';

// Separadores de controle ASCII: praticamente nunca aparecem em mensagens de commit,
// então são seguros para dividir a saída do `git log`.
const FIELD = '\x1f';
const RECORD = '\x1e';

/** Formato passado ao `git log --format=...`. A ordem precisa bater com `parseLog`. */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s'].join('%x1f') + '%x1e';

/** Converte a saída de `git log --decorate=full --format=LOG_FORMAT` em commits. */
export function parseLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  for (const chunk of raw.split(RECORD)) {
    // O git coloca uma quebra de linha entre registros; ela fica no início do próximo.
    const record = chunk.replace(/^[\r\n]+/, '');
    if (!record) continue;

    const fields = record.split(FIELD);
    if (fields.length < 7) continue;
    const [hash, parents, authorName, authorEmail, date, decorations, ...subjectParts] = fields;
    if (!hash) continue;

    commits.push({
      hash,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
      // Se por acaso o assunto tiver o separador, juntamos de volta.
      subject: subjectParts.join(FIELD),
      refs: parseRefs(decorations ?? ''),
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
