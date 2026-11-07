// Confere o formato das mensagens que chegam da extensão antes de as telas usarem.
// Uma mensagem fora do formato (de outro lugar, ou com um campo faltando) é ignorada,
// em vez de quebrar a tela no meio do desenho. Separado das telas para poder ser testado.
import type {
  BranchInfo,
  BranchStatus,
  Commit,
  CommitDetails,
  CommitFilter,
  CommitPlacement,
  FileChange,
  Ref,
  RepoOverview,
  RepoState,
  ToCommitsView,
  ToDetailsView,
} from '../../src/shared/protocol.ts';

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isGen = (value: unknown): value is number => Number.isSafeInteger(value);
const orNull = <T>(value: unknown, check: (value: unknown) => value is T): value is T | null => value === null || check(value);
const arrayOf = <T>(value: unknown, check: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(check);

const REF_TYPES = new Set(['branch', 'remote', 'tag', 'head']);
const FILE_STATUSES = new Set(['added', 'modified', 'deleted', 'renamed', 'copied', 'typeChanged', 'other']);
const MOTIONS = new Set(['auto', 'on', 'off']);

function isRef(value: unknown): value is Ref {
  return (
    isObject(value) &&
    isString(value.name) &&
    REF_TYPES.has(value.type as string) &&
    (value.current === undefined || isBoolean(value.current))
  );
}

function isCommit(value: unknown): value is Commit {
  return (
    isObject(value) &&
    isString(value.hash) &&
    arrayOf(value.parents, isString) &&
    isString(value.authorName) &&
    isString(value.authorEmail) &&
    isString(value.date) &&
    isString(value.subject) &&
    arrayOf(value.refs, isRef)
  );
}

function isFilter(value: unknown): value is CommitFilter {
  if (!isObject(value)) return false;
  if (value.kind === 'all' || value.kind === 'current') return true;
  return value.kind === 'branch' && isString(value.ref);
}

function isBranchInfo(value: unknown): value is BranchInfo {
  return (
    isObject(value) &&
    isString(value.ref) &&
    isString(value.name) &&
    (value.type === 'branch' || value.type === 'remote') &&
    isString(value.hash) &&
    isBoolean(value.current)
  );
}

function isBranchStatus(value: unknown): value is BranchStatus {
  return isObject(value) && isCount(value.ahead) && isCount(value.behind);
}

function isBase(value: unknown): value is NonNullable<RepoOverview['base']> {
  return isObject(value) && isString(value.name) && isString(value.ref) && isString(value.hash);
}

function isOverview(value: unknown): value is RepoOverview {
  return (
    isObject(value) &&
    orNull(value.base, isBase) &&
    arrayOf(value.branches, isBranchInfo) &&
    isObject(value.status) &&
    Object.values(value.status).every(isBranchStatus)
  );
}

function isRepoState(value: unknown): value is RepoState {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'noWorkspace':
    case 'notRepo':
    case 'gitMissing':
      return true;
    case 'parentRepo':
      return isString(value.root);
    case 'empty':
      return isString(value.repoName);
    case 'error':
      return isString(value.message);
    default:
      return false;
  }
}

function isFileChange(value: unknown): value is FileChange {
  return (
    isObject(value) &&
    isString(value.path) &&
    (value.oldPath === undefined || isString(value.oldPath)) &&
    FILE_STATUSES.has(value.status as string) &&
    orNull(value.additions, isNumber) &&
    orNull(value.deletions, isNumber)
  );
}

function isPlacement(value: unknown): value is CommitPlacement {
  return (
    isObject(value) &&
    orNull(value.baseName, isString) &&
    isBoolean(value.inBase) &&
    arrayOf(value.branches, isRef) &&
    isCount(value.totalBranches)
  );
}

function isCommitDetails(value: unknown): value is CommitDetails {
  return (
    isCommit(value) &&
    isObject(value) &&
    isString(value.committerName) &&
    isString(value.committerDate) &&
    isString(value.body) &&
    arrayOf(value.files, isFileChange) &&
    isCount(value.totalFiles) &&
    orNull(value.comparedTo, isString) &&
    orNull(value.placement, isPlacement)
  );
}

/** Mensagem válida para a lista de commits. */
export function isToCommitsView(data: unknown): data is ToCommitsView {
  if (!isObject(data)) return false;
  switch (data.type) {
    case 'settings':
      return MOTIONS.has(data.motion as string);
    case 'state':
      return isRepoState(data.state) && (data.gen === undefined || isGen(data.gen));
    case 'commits':
      return (
        isString(data.repoName) &&
        orNull(data.head, isString) &&
        arrayOf(data.commits, isCommit) &&
        isCount(data.skip) &&
        isBoolean(data.hasMore) &&
        isGen(data.gen) &&
        isFilter(data.filter) &&
        (data.overview === undefined || isOverview(data.overview))
      );
    case 'changed':
      return true;
    case 'select':
      return isString(data.hash);
    default:
      return false;
  }
}

/** Mensagem válida para a aba de detalhes. */
export function isToDetailsView(data: unknown): data is ToDetailsView {
  if (!isObject(data)) return false;
  switch (data.type) {
    case 'settings':
      return MOTIONS.has(data.motion as string);
    case 'loading':
      return isString(data.hash);
    case 'details':
      return isCommitDetails(data.details);
    case 'error':
      return isString(data.message);
    default:
      return false;
  }
}
