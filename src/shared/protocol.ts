// Tipos compartilhados entre a extensão (Node) e as telas (webviews).
// Tudo que passa entre os dois lados precisa estar descrito aqui.

export type RefType = 'branch' | 'remote' | 'tag' | 'head';

export interface Ref {
  /** Nome curto, ex.: "main", "origin/main", "v1.0". */
  name: string;
  type: RefType;
  /** true quando é a branch em que você está agora (HEAD aponta para ela). */
  current?: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** Data do autor em ISO 8601. */
  date: string;
  subject: string;
  refs: Ref[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typeChanged' | 'other';

export interface FileChange {
  path: string;
  /** Caminho anterior, quando o arquivo foi renomeado ou copiado. */
  oldPath?: string;
  status: FileStatus;
  /** Linhas adicionadas/removidas. `null` em arquivos binários (imagens etc.). */
  additions: number | null;
  deletions: number | null;
}

export interface CommitDetails extends Commit {
  committerName: string;
  committerDate: string;
  /** Mensagem completa sem a primeira linha. */
  body: string;
  files: FileChange[];
  /** Quantos arquivos mudaram no total (a lista `files` pode vir cortada). */
  totalFiles: number;
  /** Com qual commit as mudanças foram comparadas (o primeiro pai). `null` no primeiro commit. */
  comparedTo: string | null;
}

/** Como as animações devem se comportar na tela. */
export type MotionMode = 'auto' | 'on' | 'off';

export type RepoState =
  | { kind: 'noWorkspace' }
  | { kind: 'notRepo' }
  | { kind: 'gitMissing' }
  | { kind: 'empty'; repoName: string }
  | { kind: 'error'; message: string };

// ---------- Barra lateral (lista de commits) ----------

export type ToCommitsView =
  | { type: 'settings'; motion: MotionMode }
  | { type: 'state'; state: RepoState }
  | {
      type: 'commits';
      repoName: string;
      /** Branch atual, ou `null` se o HEAD estiver solto (detached). */
      head: string | null;
      commits: Commit[];
      /** Posição do primeiro commit desta página (0 = começo da lista). */
      skip: number;
      hasMore: boolean;
    }
  /** O repositório mudou (commit, troca de branch, fetch...). */
  | { type: 'changed' }
  /** Outro lugar (ex.: a aba de detalhes) selecionou um commit. */
  | { type: 'select'; hash: string };

export type FromCommitsView =
  | { type: 'ready' }
  | { type: 'loadMore'; skip: number }
  /** Recarrega do começo mantendo pelo menos `count` commits. */
  | { type: 'reload'; count: number }
  | { type: 'openCommit'; hash: string }
  | { type: 'openFolder' };

// ---------- Aba de detalhes do commit ----------

export type ToDetailsView =
  | { type: 'settings'; motion: MotionMode }
  | { type: 'loading'; hash: string }
  | { type: 'details'; details: CommitDetails }
  | { type: 'error'; message: string };

export type FromDetailsView =
  | { type: 'ready' }
  /** Abre o "antes e depois" do arquivo na posição `index` de `details.files`. */
  | { type: 'openFile'; index: number }
  | { type: 'openCommit'; hash: string }
  | { type: 'copyHash' };
