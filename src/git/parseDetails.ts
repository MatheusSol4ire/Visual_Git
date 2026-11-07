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

  const message = messageParts.join(FIELD).replace(/\r\n/g, '\n').trimEnd();
  const newline = message.indexOf('\n');
  const subject = newline === -1 ? message : message.slice(0, newline);
  const body = newline === -1 ? '' : message.slice(newline + 1).replace(/^\n+/, '');

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
 * Junta a saída de `git diff-tree -z --name-status` e `git diff-tree -z --numstat`
 * (mesmos argumentos) numa lista de arquivos alterados.
 */
export function parseFileChanges(nameStatus: string, numstat: string): FileChange[] {
  const files: FileChange[] = [];
  const byPath = new Map<string, FileChange>();

  const status = nameStatus.split('\0');
  for (let i = 0; i < status.length; ) {
    const code = status[i];
    if (!code) {
      i += 1;
      continue;
    }
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = status[i + 1] ?? '';
      const path = status[i + 2] ?? '';
      i += 3;
      const file: FileChange = { path, oldPath, status: toStatus(code), additions: null, deletions: null };
      files.push(file);
      byPath.set(path, file);
    } else {
      const path = status[i + 1] ?? '';
      i += 2;
      const file: FileChange = { path, status: toStatus(code), additions: null, deletions: null };
      files.push(file);
      byPath.set(path, file);
    }
  }

  const numbers = numstat.split('\0');
  for (let i = 0; i < numbers.length; ) {
    const entry = numbers[i];
    if (!entry) {
      i += 1;
      continue;
    }
    const [added = '-', deleted = '-', inlinePath = ''] = entry.split('\t');
    let path = inlinePath;
    if (inlinePath === '') {
      // Renomeação: o caminho antigo e o novo vêm nos dois próximos itens.
      path = numbers[i + 2] ?? '';
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
