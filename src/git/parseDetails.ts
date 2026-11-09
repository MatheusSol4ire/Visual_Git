import type { FileChange, FileStatus } from '../shared/protocol.ts';
import { isFullHash, parseParents, parseRefs } from './parseLog.ts';

// NUL: o Git nunca o coloca em nomes ou mensagens, então um texto do repositório não desloca os campos.
const FIELD = '\0';

/** Formato do `git show -s` para os detalhes. A ordem precisa bater com `parseShow`. */
export const SHOW_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%D', '%B'].join('%x00');

export interface ShowInfo {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  date: string;
  committerName: string;
  committerDate: string;
  refs: ReturnType<typeof parseRefs>;
  subject: string;
  body: string;
}

export function parseShow(raw: string): ShowInfo | undefined {
  const fields = raw.replace(/^[\r\n]+/, '').split(FIELD);
  if (fields.length < 9) return undefined;
  const [hash = '', parentList = '', authorName, authorEmail, date, committerName, committerDate, decorations, ...messageParts] = fields;
  // Hash e pais vão para outros comandos do Git: só aceitamos hashes completos de verdade.
  const parents = parseParents(parentList);
  if (!isFullHash(hash) || !parents) return undefined;

  const { subject, body } = splitMessage(messageParts.join(FIELD));

  return {
    hash,
    parents,
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    committerName: committerName ?? '',
    committerDate: committerDate ?? '',
    refs: parseRefs(decorations ?? ''),
    subject,
    body,
  };
}

/** Linha "em branco" para o Git: só espaços ASCII (o `isspace` dele). */
const BLANK = /^[ \t\v\f\r]*$/;

/**
 * Separa a mensagem (%B) em título e corpo com a mesma regra do `%s` do Git, que é o que a lista
 * mostra: pula linhas em branco do começo, e o título é o 1º PARÁGRAFO inteiro, com as linhas
 * juntadas por espaço (sem os espaços do fim de cada uma). O corpo é o resto, sem as linhas em branco
 * que o separam do título.
 */
export function splitMessage(raw: string): { subject: string; body: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && BLANK.test(lines[i] ?? '')) i += 1;
  const subject: string[] = [];
  while (i < lines.length && !BLANK.test(lines[i] ?? '')) {
    subject.push((lines[i] ?? '').replace(/[ \t\v\f\r]+$/, ''));
    i += 1;
  }
  while (i < lines.length && BLANK.test(lines[i] ?? '')) i += 1;
  return { subject: subject.join(' '), body: lines.slice(i).join('\n').trimEnd() };
}

function toStatus(code: string): FileStatus {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'typeChanged';
    default:
      return 'other';
  }
}

/**
 * Lê a saída de `git diff-tree -z --raw [--numstat]` numa lista de arquivos alterados.
 *
 * Com `-z` o Git não escapa nada nos caminhos, e cada item vem separado por NUL:
 * - `--raw`: um cabeçalho ":modo modo hash hash STATUS" e depois o caminho (dois, em renomeação/cópia);
 * - `--numstat` (vem depois de todo o `--raw`): "mais\tmenos\tcaminho" ou, em renomeação,
 *   "mais\tmenos\t" e depois o caminho antigo e o novo.
 * Os caminhos são consumidos pela posição, então um nome de arquivo nunca é lido como cabeçalho.
 */
export function parseDiffTree(raw: string): FileChange[] {
  const files: FileChange[] = [];
  const byPath = new Map<string, FileChange>();
  const items = raw.split('\0');

  for (let i = 0; i < items.length; ) {
    const item = items[i] ?? '';
    if (!item) {
      i += 1;
      continue;
    }
    if (item.startsWith(':')) {
      // Cabeçalho do --raw: a letra de status é o último campo (ex.: "M", "R087").
      const code = item.slice(item.lastIndexOf(' ') + 1);
      const pair = code[0] === 'R' || code[0] === 'C';
      const oldPath = pair ? (items[i + 1] ?? '') : undefined;
      const path = items[i + (pair ? 2 : 1)] ?? '';
      i += pair ? 3 : 2;
      const file: FileChange = { path, ...(oldPath !== undefined ? { oldPath } : {}), status: toStatus(code), additions: null, deletions: null };
      files.push(file);
      byPath.set(path, file);
      continue;
    }
    // Linha do --numstat. O caminho pode ter TAB no nome: tudo depois do 2º TAB é caminho.
    const [added = '-', deleted = '-', ...rest] = item.split('\t');
    let path = rest.join('\t');
    if (path === '') {
      // Renomeação: o caminho antigo e o novo vêm nos dois próximos itens.
      path = items[i + 2] ?? '';
      i += 3;
    } else {
      i += 1;
    }
    const file = byPath.get(path);
    if (!file) continue;
    file.additions = added === '-' ? null : Number(added);
    file.deletions = deleted === '-' ? null : Number(deleted);
  }

  return files;
}
