// Tipos compartilhados entre a extensão (Node) e a tela (webview).
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

/** Como as animações devem se comportar na tela. */
export type MotionMode = 'auto' | 'on' | 'off';

export type RepoState =
  | { kind: 'noWorkspace' }
  | { kind: 'notRepo' }
  | { kind: 'gitMissing' }
  | { kind: 'empty'; repoName: string }
  | { kind: 'error'; message: string };

/** Mensagens da extensão para a tela. */
export type ToWebview =
  | { type: 'settings'; motion: MotionMode }
  | { type: 'state'; state: RepoState }
  | {
      type: 'commits';
      repoName: string;
      commits: Commit[];
      /** Posição do primeiro commit desta página (0 = começo da lista). */
      skip: number;
      hasMore: boolean;
    };

/** Mensagens da tela para a extensão. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'loadMore'; skip: number }
  | { type: 'refresh' };
