import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Commit, FromCommitsView, RepoState, ToCommitsView } from '../../src/shared/protocol.ts';
import { GraphCell } from '../graph/GraphCell.tsx';
import { createLayoutState, layoutCommits, type GraphRow, type LayoutState } from '../graph/layout.ts';
import { Avatar, RefChips } from '../shared/components.tsx';
import { timeAgo } from '../shared/format.ts';
import { applyMotion, getVsCode } from '../shared/vscode.ts';
import '../styles/base.css';
import '../styles/commits.css';

const vscode = getVsCode<FromCommitsView>();

const ROW_HEIGHT = 44;
/** Linhas extras desenhadas acima/abaixo da área visível, para a rolagem ficar lisa. */
const OVERSCAN = 8;
/** Acima disso o grafo é cortado, para não engolir a barra lateral. */
const MAX_LANES = 10;

interface Data {
  repoName: string;
  head: string | null;
  commits: Commit[];
  rows: GraphRow[];
  hasMore: boolean;
}

type View = { kind: 'loading' } | { kind: 'state'; state: RepoState } | { kind: 'commits'; data: Data };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const layout = useRef<LayoutState>(createLayoutState());
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToCommitsView>) => {
      const message = event.data;
      switch (message.type) {
        case 'settings':
          applyMotion(message.motion);
          break;
        case 'state':
          setView({ kind: 'state', state: message.state });
          break;
        case 'changed': {
          const current = viewRef.current;
          const count = current.kind === 'commits' ? current.data.commits.length : 0;
          vscode.postMessage({ type: 'reload', count });
          break;
        }
        case 'select':
          setSelected(message.hash);
          break;
        case 'commits': {
          const previous = viewRef.current;
          const continuing = message.skip > 0 && previous.kind === 'commits';
          if (!continuing) layout.current = createLayoutState();
          const rows = layoutCommits(message.commits, layout.current);

          if (continuing) {
            const data = previous.data;
            setView({
              kind: 'commits',
              data: {
                ...data,
                head: message.head,
                commits: [...data.commits.slice(0, message.skip), ...message.commits],
                rows: [...data.rows.slice(0, message.skip), ...rows],
                hasMore: message.hasMore,
              },
            });
          } else {
            if (previous.kind === 'commits') {
              // Recarga: destaca por um instante os commits que acabaram de aparecer.
              const known = new Set(previous.data.commits.map((c) => c.hash));
              const added = message.commits.filter((c) => !known.has(c.hash)).map((c) => c.hash);
              if (added.length > 0 && added.length < 50) setFresh(new Set(added));
            } else {
              setEntering(true);
            }
            setView({
              kind: 'commits',
              data: { repoName: message.repoName, head: message.head, commits: message.commits, rows, hasMore: message.hasMore },
            });
          }
          break;
        }
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => setEntering(false), 700);
    return () => clearTimeout(timer);
  }, [entering]);

  useEffect(() => {
    if (fresh.size === 0) return;
    const timer = setTimeout(() => setFresh(new Set()), 1600);
    return () => clearTimeout(timer);
  }, [fresh]);

  const open = useCallback((hash: string) => {
    setSelected(hash);
    vscode.postMessage({ type: 'openCommit', hash });
  }, []);

  if (view.kind === 'loading') return <Skeleton />;
  if (view.kind === 'state') return <StateNotice state={view.state} />;

  return (
    <div class="layout">
      <Header repoName={view.data.repoName} head={view.data.head} />
      <CommitList data={view.data} selected={selected} entering={entering} fresh={fresh} onSelect={setSelected} onOpen={open} />
    </div>
  );
}

function Header({ repoName, head }: { repoName: string; head: string | null }) {
  return (
    <header class="header">
      <span class="header-repo" title={`Projeto: ${repoName}`}>
        {repoName}
      </span>
      <span class="header-branch" title={head ? `Você está na branch ${head}` : 'Você não está em nenhuma branch (HEAD solto)'}>
        <BranchIcon />
        {head ?? 'sem branch'}
      </span>
    </header>
  );
}

interface ListProps {
  data: Data;
  selected: string | null;
  entering: boolean;
  fresh: Set<string>;
  onSelect: (hash: string) => void;
  onOpen: (hash: string) => void;
}

/** Lista "virtualizada": só desenha as linhas que estão na tela, então aguenta milhares de commits. */
function CommitList({ data, selected, entering, fresh, onSelect, onOpen }: ListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const requested = useRef(-1);
  const { commits, rows, hasMore } = data;

  const lanes = useMemo(() => Math.min(MAX_LANES, rows.reduce((max, row) => Math.max(max, row.width), 1)), [rows]);
  const headHash = useMemo(() => commits.find((c) => c.refs.some((r) => r.current || r.type === 'head'))?.hash, [commits]);
  const selectedIndex = selected ? commits.findIndex((c) => c.hash === selected) : -1;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Pede mais commits quando a rolagem chega perto do fim.
  useEffect(() => {
    const nearEnd = scrollTop + height > commits.length * ROW_HEIGHT - ROW_HEIGHT * 15;
    if (hasMore && nearEnd && requested.current !== commits.length) {
      requested.current = commits.length;
      vscode.postMessage({ type: 'loadMore', skip: commits.length });
    }
  }, [scrollTop, height, commits.length, hasMore]);

  // Mantém o commit selecionado visível (teclado ou seleção vinda da aba de detalhes).
  useEffect(() => {
    const element = scroller.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, [selectedIndex]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (commits.length === 0) return;
    const pageRows = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: pageRows,
      PageUp: -pageRows,
      Home: -Infinity,
      End: Infinity,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      const from = selectedIndex < 0 ? (move > 0 ? -1 : 0) : selectedIndex;
      const next = Math.max(0, Math.min(commits.length - 1, from + move));
      const commit = commits[next];
      if (commit) onSelect(commit.hash);
    } else if ((event.key === 'Enter' || event.key === ' ') && selected) {
      event.preventDefault();
      onOpen(selected);
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = [];
  for (let i = first; i < last; i++) {
    const commit = commits[i];
    const row = rows[i];
    if (!commit || !row) continue;
    visible.push(
      <CommitRow
        key={commit.hash}
        index={i}
        commit={commit}
        row={row}
        lanes={lanes}
        isHead={commit.hash === headHash}
        selected={commit.hash === selected}
        entering={entering}
        fresh={fresh.has(commit.hash)}
        onOpen={onOpen}
      />,
    );
  }

  return (
    <div
      ref={scroller}
      class="scroller"
      tabIndex={0}
      role="listbox"
      aria-label="Commits"
      aria-activedescendant={selected ? `commit-${selected}` : undefined}
      onScroll={(event) => setScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div class="spacer" style={{ height: `${commits.length * ROW_HEIGHT + (hasMore ? ROW_HEIGHT : 0)}px` }}>
        {visible}
        {hasMore && (
          <div class="loading-more" style={{ top: `${commits.length * ROW_HEIGHT}px` }}>
            Carregando mais commits…
          </div>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  index: number;
  commit: Commit;
  row: GraphRow;
  lanes: number;
  isHead: boolean;
  selected: boolean;
  entering: boolean;
  fresh: boolean;
  onOpen: (hash: string) => void;
}

function CommitRow({ index, commit, row, lanes, isHead, selected, entering, fresh, onOpen }: RowProps) {
  const classes = ['row'];
  if (selected) classes.push('selected');
  if (entering) classes.push('enter');
  if (fresh) classes.push('fresh');

  return (
    <div
      id={`commit-${commit.hash}`}
      class={classes.join(' ')}
      role="option"
      aria-selected={selected}
      style={{
        top: `${index * ROW_HEIGHT}px`,
        animationDelay: entering ? `${Math.min(index, 14) * 22}ms` : undefined,
      }}
      title={`${commit.subject}\n${commit.authorName} · ${new Date(commit.date).toLocaleString('pt-BR')}`}
      onClick={() => onOpen(commit.hash)}
    >
      <GraphCell row={row} lanes={lanes} height={ROW_HEIGHT} isHead={isHead} />
      <Avatar name={commit.authorName} email={commit.authorEmail} />
      <div class="row-text">
        <div class="row-subject">{commit.subject || <span class="muted">(sem mensagem)</span>}</div>
        <div class="row-meta">
          <span class="row-author">
            {commit.authorName} · {timeAgo(commit.date)}
          </span>
          <RefChips refs={commit.refs} />
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="layout" aria-busy="true" aria-label="Carregando commits">
      <div class="header">
        <span class="skeleton" style={{ width: '40%', height: '12px' }} />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div class="skeleton-row" key={i} style={{ animationDelay: `${i * 80}ms` }}>
          <span class="skeleton skeleton-dot" />
          <span class="skeleton-lines">
            <span class="skeleton" style={{ width: `${80 - (i % 3) * 15}%`, height: '10px' }} />
            <span class="skeleton" style={{ width: '35%', height: '8px' }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function StateNotice({ state }: { state: RepoState }) {
  switch (state.kind) {
    case 'noWorkspace':
      return (
        <div class="empty">
          <span class="empty-title">Nenhum projeto aberto</span>
          <span>Abra a pasta de um projeto para ver o histórico de commits.</span>
          <button type="button" onClick={() => vscode.postMessage({ type: 'openFolder' })}>
            Abrir pasta
          </button>
        </div>
      );
    case 'notRepo':
      return (
        <div class="empty">
          <span class="empty-title">Esta pasta não usa Git</span>
          <span>Quando o projeto tiver Git, o histórico aparece aqui.</span>
        </div>
      );
    case 'gitMissing':
      return (
        <div class="empty">
          <span class="empty-title">Git não encontrado</span>
          <span>Instale o Git (git-scm.com) e reabra o VS Code.</span>
        </div>
      );
    case 'empty':
      return (
        <div class="empty">
          <span class="empty-title">Nenhum commit ainda</span>
          <span>O projeto {state.repoName} ainda não tem commits. Faça o primeiro e ele aparece aqui.</span>
        </div>
      );
    case 'error':
      return (
        <div class="empty error">
          <span class="empty-title">Algo deu errado</span>
          <span>{state.message}</span>
        </div>
      );
  }
}

function BranchIcon() {
  return (
    <svg class="branch-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4.5" cy="3.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      <circle cx="4.5" cy="12.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      <circle cx="11.5" cy="5.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-2.5 3-5.6 4.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
