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
  /** Mensagem completa sem o título (o 1º parágrafo, que vai em `subject`, como na lista). */
  body: string;
  files: FileChange[];
  /** Quantos arquivos mudaram no total (a lista `files` pode vir cortada). */
  totalFiles: number;
  /**
   * Linhas adicionadas e removidas somadas em TODOS os arquivos do commit, não só nos que vieram em
   * `files` (que pode vir cortada). Arquivos binários não entram. `0` quando `uncounted`.
   */
  totalAdditions: number;
  totalDeletions: number;
  /** Com qual commit as mudanças foram comparadas (o primeiro pai). `null` no primeiro commit. */
  comparedTo: string | null;
  /** Em quais branches este commit aparece. `null` se não deu para descobrir. */
  placement: CommitPlacement | null;
  /**
   * `true` quando as linhas (+/−) não foram contadas: commit com arquivos demais, ou conteúdo dos
   * arquivos fora do computador (clone parcial sem internet). Aí `additions`/`deletions` vêm `null`
   * sem que o arquivo seja binário.
   */
  uncounted?: true;
}

/** Onde um commit está: se já entrou na branch principal e em quais branches ele aparece. */
export interface CommitPlacement {
  /** Nome da branch principal (ex.: "main"), ou `null` se o projeto não tiver uma. */
  baseName: string | null;
  /** Se o commit já faz parte da branch principal. */
  inBase: boolean;
  /** Branches (locais e do servidor) que têm este commit. */
  branches: Ref[];
  /** Quantas branches têm o commit no total (`branches` pode vir cortada). */
  totalBranches: number;
}

// ---------- Branches ----------

export interface BranchInfo {
  /** Nome completo, ex.: "refs/heads/main". É o identificador usado no filtro. */
  ref: string;
  /** Nome curto, ex.: "main" ou "origin/main". */
  name: string;
  type: 'branch' | 'remote';
  /** Commit para onde a branch aponta. */
  hash: string;
  /** true quando é a branch em que você está agora. */
  current: boolean;
}

/** Comparação de uma ponta de branch com a branch principal. */
export interface BranchStatus {
  /** Commits desta branch que ainda não estão na principal. */
  ahead: number;
  /** Commits da principal que esta branch ainda não tem. */
  behind: number;
}

export interface RepoOverview {
  /** A branch principal (main, master ou a padrão do servidor). Fica sempre no primeiro trilho do grafo. */
  base: { name: string; ref: string; hash: string } | null;
  branches: BranchInfo[];
  /** Por hash da ponta de cada branch: quanto ela está à frente/atrás da principal. */
  status: Record<string, BranchStatus>;
}

/** Quais branches a lista mostra. */
export type CommitFilter =
  | { kind: 'all' }
  /** A branch atual junto com a principal. */
  | { kind: 'current' }
  /** Uma branch escolhida (pelo nome completo) junto com a principal. */
  | { kind: 'branch'; ref: string };

/** Como as animações devem se comportar na tela. */
export type MotionMode = 'auto' | 'on' | 'off';

export type RepoState =
  | { kind: 'noWorkspace' }
  | { kind: 'notRepo' }
  /** O Git do projeto está numa pasta acima da aberta (`root`): só abrimos se o usuário aceitar. */
  | { kind: 'parentRepo'; root: string }
  | { kind: 'gitMissing' }
  | { kind: 'empty'; repoName: string }
  | { kind: 'error'; message: string };

// ---------- Barra lateral (lista de commits) ----------

export type ToCommitsView =
  | { type: 'settings'; motion: MotionMode }
  /** `gen` repete o número do pedido que deu neste estado (ausente quando não veio de um pedido). */
  | { type: 'state'; state: RepoState; gen?: number }
  | {
      type: 'commits';
      repoName: string;
      /** Branch atual, ou `null` se o HEAD estiver solto (detached). */
      head: string | null;
      commits: Commit[];
      /** Posição do primeiro commit desta página (0 = começo da lista). */
      skip: number;
      hasMore: boolean;
      /** Repete o número do pedido, para a tela descartar respostas de um filtro antigo. */
      gen: number;
      /** O filtro que foi aplicado de fato (volta para "todas" se a branch escolhida sumiu). */
      filter: CommitFilter;
      /** Branches e comparações com a principal. Só vem na primeira página. */
      overview?: RepoOverview;
    }
  /** O repositório mudou (commit, troca de branch, fetch...). */
  | { type: 'changed' }
  /** Outro lugar (ex.: a aba de detalhes) selecionou um commit. */
  | { type: 'select'; hash: string };

export type FromCommitsView =
  | { type: 'ready' }
  /**
   * Pede commits a partir de `skip`. Com `skip` 0 recarrega do começo trazendo pelo menos `count`.
   * `gen` muda a cada troca de filtro e volta na resposta.
   */
  | { type: 'load'; gen: number; filter: CommitFilter; skip: number; count: number }
  | { type: 'openCommit'; hash: string }
  | { type: 'openFolder' }
  /** Abre a área Controle do Código-Fonte do VS Code (projeto sem commits: onde se faz o primeiro). */
  | { type: 'openSourceControl' }
  /** Aceita o repositório da pasta acima. `always`: para todos os projetos (muda a configuração do Git). */
  | { type: 'openParentRepo'; always: boolean };

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
