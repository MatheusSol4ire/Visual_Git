import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Commit, CommitFilter, FromCommitsView, Ref, RepoOverview, RepoState, ToCommitsView } from '../../src/shared/protocol.ts';
import { GraphCell } from '../graph/GraphCell.tsx';
import { createLayoutState, layoutCommits, type GraphRow, type LayoutState } from '../graph/layout.ts';
import { Avatar, RefChips } from '../shared/components.tsx';
import { timeAgo } from '../shared/format.ts';
import { firstGen, parseSavedList, type SavedList } from '../shared/savedState.ts';
import { isToCommitsView } from '../shared/messages.ts';
import { applyMotion, getVsCode, onHostMessage } from '../shared/vscode.ts';
import {
  aheadBadge,
  currentBranchSummary,
  currentOptionLabel,
  filterFromValue,
  filterValue,
  sameFilter,
} from './branchText.ts';
import { followPinned, keepPreview, litCommits, sameRef, type Highlight } from './highlight.ts';
import '../styles/base.css';
import '../styles/commits.css';

const vscode = getVsCode<FromCommitsView>();

const ROW_HEIGHT = 44;
/** Linhas extras desenhadas acima/abaixo da área visível, para a rolagem ficar lisa. */
const OVERSCAN = 8;
/** Acima disso o grafo é cortado, para não engolir a barra lateral. */
const MAX_LANES = 10;

// Sem `retainContextWhenHidden`, o VS Code destrói esta tela quando ela fica escondida (ex.: ao ir para
// o Explorador) e a recria ao voltar. Guardamos o essencial para ela voltar como estava.
const saved = parseSavedList(vscode.getState());
let remembered: SavedList = saved;
function remember(patch: Partial<SavedList>): void {
  remembered = { ...remembered, ...patch };
  vscode.setState(remembered);
}
/** Rolagem salva, usada uma vez só, quando a primeira lista desta tela aparecer. */
let pendingScroll = saved.scrollTop;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
function rememberScroll(scrollTop: number): void {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => remember({ scrollTop }), 150);
}

interface Data {
  repoName: string;
  head: string | null;
  commits: Commit[];
  rows: GraphRow[];
  hasMore: boolean;
  overview: RepoOverview | undefined;
  filter: CommitFilter;
  /** Número do pedido que trouxe esta lista (muda a cada recarga ou troca de filtro). */
  gen: number;
}

type View = { kind: 'loading' } | { kind: 'state'; state: RepoState } | { kind: 'commits'; data: Data };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [filter, setFilterState] = useState<CommitFilter>(saved.filter);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(saved.selected);
  const [entering, setEntering] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Highlight | null>(saved.pinned);
  const [preview, setPreview] = useState<Highlight | null>(null);
  const layout = useRef<LayoutState>(createLayoutState());
  const viewRef = useRef(view);
  viewRef.current = view;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  /**
   * Muda a cada troca de filtro ou recarga; respostas com outro número são de um pedido antigo.
   * Começa depois do último número da tela anterior, para não aceitar respostas pedidas por ela.
   */
  const gen = useRef(firstGen(saved));
  const nextGen = () => {
    gen.current += 1;
    remember({ gen: gen.current });
  };
  /** A tela foi recriada com uma lista já vista: sem animação de entrada. */
  const restoring = useRef(saved.count > 0);

  const saveFilter = (next: CommitFilter) => {
    setFilterState(next);
    filterRef.current = next;
    remember({ filter: next });
  };

  const load = useCallback((skip: number, count = 0) => {
    vscode.postMessage({ type: 'load', gen: gen.current, filter: filterRef.current, skip, count });
  }, []);

  /** "Carregar mais" da lista da tela; nada enquanto uma lista nova (recarga ou outro filtro) está a caminho. */
  const loadMore = useCallback(
    (skip: number) => {
      const current = viewRef.current;
      if (current.kind === 'commits' && current.data.gen === gen.current) load(skip);
    },
    [load],
  );

  useEffect(() => {
    const onMessage = (message: ToCommitsView) => {
      switch (message.type) {
        case 'settings':
          applyMotion(message.motion);
          break;
        case 'state':
          if (message.gen !== undefined && message.gen !== gen.current) return; // de um pedido antigo
          setBusy(false);
          setView({ kind: 'state', state: message.state });
          break;
        case 'changed': {
          // Novo número de pedido: respostas de "carregar mais" ainda a caminho são da lista antiga.
          nextGen();
          const current = viewRef.current;
          load(0, current.kind === 'commits' ? current.data.commits.length : 0);
          break;
        }
        case 'select':
          setSelected(message.hash);
          break;
        case 'commits': {
          if (message.gen !== gen.current) return; // resposta de um filtro que já foi trocado
          const previous = viewRef.current;
          // "Carregar mais": só emenda na lista que está na tela, se ela veio deste mesmo pedido e termina
          // onde a página começa. Senão a página é de uma lista nova que ainda não chegou: descarta.
          if (
            message.skip > 0 &&
            (previous.kind !== 'commits' || previous.data.gen !== message.gen || previous.data.commits.length !== message.skip)
          ) {
            return;
          }
          setBusy(false);
          // A branch escolhida pode ter sido apagada: a extensão avisa qual filtro valeu de fato.
          if (!sameFilter(message.filter, filterRef.current)) saveFilter(message.filter);

          const continuing = message.skip > 0 && previous.kind === 'commits';
          const restored = restoring.current;
          restoring.current = false;
          if (!continuing) layout.current = createLayoutState(message.overview?.base?.hash ?? null);
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
            const sameList = previous.kind === 'commits' && sameFilter(previous.data.filter, message.filter);
            if (sameList) {
              // Recarga: destaca por um instante os commits que acabaram de aparecer.
              const known = new Set(previous.data.commits.map((c) => c.hash));
              const added = message.commits.filter((c) => !known.has(c.hash)).map((c) => c.hash);
              if (added.length > 0 && added.length < 50) setFresh(new Set(added));
            } else if (!restored) {
              setEntering(true);
            }
            setView({
              kind: 'commits',
              data: {
                repoName: message.repoName,
                head: message.head,
                commits: message.commits,
                rows,
                hasMore: message.hasMore,
                overview: message.overview,
                filter: message.filter,
                gen: message.gen,
              },
            });
          }
          break;
        }
      }
    };
    const stop = onHostMessage(isToCommitsView, onMessage);
    remember({ gen: gen.current });
    vscode.postMessage({ type: 'ready' });
    // Tela recriada: pede de novo tudo o que já estava carregado, para a rolagem voltar ao mesmo lugar.
    load(0, saved.count);
    return stop;
  }, [load]);

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

  const changeFilter = (next: CommitFilter) => {
    if (sameFilter(next, filterRef.current)) return;
    nextGen();
    saveFilter(next);
    setPinned(null);
    setPreview(null);
    setBusy(true);
    load(0);
  };

  // A cada lista nova, o destaque segue a etiqueta (nome e tipo): se a branch ganhou commits,
  // ele vai para a ponta nova; se a etiqueta sumiu, o destaque é desligado. A prévia do mouse
  // é largada se a etiqueta saiu do commit (a recarga a tira da tela sem avisar com mouseleave).
  const commitsNow = view.kind === 'commits' ? view.data.commits : null;
  useEffect(() => {
    if (!commitsNow) return;
    setPinned((current) => followPinned(current, commitsNow));
    setPreview((current) => keepPreview(current, commitsNow));
  }, [commitsNow]);

  useEffect(() => remember({ selected }), [selected]);
  useEffect(() => remember({ pinned }), [pinned]);
  useEffect(() => {
    if (commitsNow) remember({ count: commitsNow.length });
  }, [commitsNow]);

  const pick = useCallback((hash: string, ref: Ref) => {
    setPinned((current) => (current?.hash === hash && sameRef(current, ref) ? null : { hash, name: ref.name, type: ref.type }));
  }, []);

  // Saídas da tela de erro: pedir de novo, ou voltar para "todas as branches" (o filtro guardado
  // pode ser justamente o que dá erro, e a tela de erro não tem a barra "Mostrar").
  const retry = () => {
    nextGen();
    setView({ kind: 'loading' });
    load(0, remembered.count);
  };
  const showAll = () => {
    nextGen();
    saveFilter({ kind: 'all' });
    setPinned(null);
    setPreview(null);
    setView({ kind: 'loading' });
    load(0);
  };

  if (view.kind === 'loading') return <Skeleton />;
  if (view.kind === 'state') {
    return <StateNotice state={view.state} onRetry={retry} onShowAll={filter.kind === 'all' ? null : showAll} />;
  }

  const { data } = view;
  return (
    <div class={busy ? 'layout busy' : 'layout'}>
      <Header repoName={data.repoName} head={data.head} />
      <FilterBar data={data} filter={filter} onChange={changeFilter} />
      <BranchSummary overview={data.overview} />
      {pinned && <HighlightBar name={pinned.name} onClear={() => setPinned(null)} />}
      <CommitList
        data={data}
        selected={selected}
        entering={entering}
        fresh={fresh}
        highlight={preview ?? pinned}
        onSelect={setSelected}
        onOpen={open}
        onLoadMore={loadMore}
        onPick={pick}
        onPreview={setPreview}
        onClearHighlight={() => {
          setPinned(null);
          setPreview(null);
        }}
      />
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

/** "Mostrar: [todas as branches ▾]" */
function FilterBar({ data, filter, onChange }: { data: Data; filter: CommitFilter; onChange: (filter: CommitFilter) => void }) {
  const branches = data.overview?.branches ?? [];
  const local = branches.filter((b) => b.type === 'branch');
  const remote = branches.filter((b) => b.type === 'remote');
  const baseName = data.overview?.base?.name ?? null;
  const together = baseName ? ` (junto com a ${baseName})` : '';

  return (
    <div class="filter-bar">
      <label class="filter-label" for="branch-filter">
        Mostrar
      </label>
      <span class="filter-wrap">
        <select
          id="branch-filter"
          class="filter"
          value={filterValue(filter)}
          title="Escolha quais branches aparecem na lista"
          onChange={(event) => onChange(filterFromValue((event.currentTarget as HTMLSelectElement).value))}
        >
          <option value="all">Todas as branches</option>
          <option value="current">{currentOptionLabel(data.head, baseName)}</option>
          {local.length > 0 && (
            <optgroup label={`No seu computador${together}`}>
              {local.map((b) => (
                <option key={b.ref} value={`ref:${b.ref}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
          {remote.length > 0 && (
            <optgroup label={`No servidor${together}`}>
              {remote.map((b) => (
                <option key={b.ref} value={`ref:${b.ref}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <ChevronIcon />
      </span>
    </div>
  );
}

/** Frase simples sobre a branch atual: o que ainda não foi para a main e o que a main tem de novo. */
function BranchSummary({ overview }: { overview: RepoOverview | undefined }) {
  const { ahead, behind } = currentBranchSummary(overview);
  if (!ahead && !behind) return null;
  return (
    <div class="summary" role="status">
      <InfoIcon />
      <span>
        {ahead}
        {ahead && behind && ' '}
        {behind}
      </span>
    </div>
  );
}

function HighlightBar({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div class="highlight-bar" role="status">
      <span class="highlight-text">
        Destacando o caminho de <strong>{name}</strong>
      </span>
      <button type="button" class="ghost small-button" onClick={onClear} title="Parar de destacar (Esc)">
        Limpar
      </button>
    </div>
  );
}

interface ListProps {
  data: Data;
  selected: string | null;
  entering: boolean;
  fresh: Set<string>;
  highlight: Highlight | null;
  onSelect: (hash: string) => void;
  onOpen: (hash: string) => void;
  onLoadMore: (skip: number) => void;
  onPick: (hash: string, ref: Ref) => void;
  onPreview: (highlight: Highlight | null) => void;
  onClearHighlight: () => void;
}

/** Lista "virtualizada": só desenha as linhas que estão na tela, então aguenta milhares de commits. */
function CommitList(props: ListProps) {
  const { data, selected, entering, fresh, highlight, onSelect, onOpen, onLoadMore, onPick, onPreview, onClearHighlight } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  /**
   * Último "carregar mais" pedido: de qual lista (gen) e a partir de onde. Lista nova (recarga ou
   * outro filtro) libera o próximo, mesmo que um pedido da lista antiga tenha sido descartado.
   */
  const requested = useRef({ gen: data.gen, skip: -1 });
  const { commits, rows, hasMore, overview } = data;

  const lanes = useMemo(() => Math.min(MAX_LANES, rows.reduce((max, row) => Math.max(max, row.width), 1)), [rows]);
  const headHash = useMemo(() => commits.find((c) => c.refs.some((r) => r.current || r.type === 'head'))?.hash, [commits]);
  const lit = useMemo(() => litCommits(highlight, commits), [highlight?.hash, commits]);
  const selectedIndex = selected ? commits.findIndex((c) => c.hash === selected) : -1;
  const shownFilter = filterValue(data.filter);
  const lastFilter = useRef(shownFilter);
  // Último commit selecionado que já foi trazido para a tela. Com rolagem salva para restaurar,
  // a seleção não puxa a lista para outro lugar ao abrir.
  const lastSelected = useRef(pendingScroll > 0 ? selected : null);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    // Tela recriada: volta para a rolagem de antes (uma vez só).
    if (pendingScroll > 0) {
      element.scrollTop = pendingScroll;
      setScrollTop(element.scrollTop);
    }
    pendingScroll = 0;
    return () => observer.disconnect();
  }, []);

  // Outro filtro: a lista pode ser bem diferente, então volta para o topo.
  useEffect(() => {
    if (lastFilter.current === shownFilter) return;
    lastFilter.current = shownFilter;
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
  }, [shownFilter]);

  // Pede mais commits quando a rolagem chega perto do fim. Roda também a cada lista nova (data.gen):
  // uma recarga pode chegar com o mesmo tamanho e a rolagem parada no fim, sem mais nada mudar.
  useEffect(() => {
    const nearEnd = scrollTop + height > commits.length * ROW_HEIGHT - ROW_HEIGHT * 15;
    const asked = requested.current.gen === data.gen && requested.current.skip === commits.length;
    if (hasMore && nearEnd && !asked) {
      requested.current = { gen: data.gen, skip: commits.length };
      onLoadMore(commits.length);
    }
  }, [scrollTop, height, commits.length, hasMore, onLoadMore, data.gen]);

  // Mantém o commit selecionado visível (teclado ou seleção vinda da aba de detalhes).
  // Só quando a seleção muda de fato: uma recarga que põe commits acima dele muda a posição,
  // mas não pode puxar a lista de volta enquanto a pessoa lê outra parte do histórico.
  useEffect(() => {
    if (selected === lastSelected.current) return;
    lastSelected.current = selected;
    const element = scroller.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClearHighlight();
      return;
    }
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
        lit={lit}
        activeRef={highlight?.hash === commit.hash ? highlight : null}
        overview={overview}
        onOpen={onOpen}
        onPick={onPick}
        onPreview={onPreview}
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
      onScroll={(event) => {
        const top = (event.currentTarget as HTMLDivElement).scrollTop;
        setScrollTop(top);
        rememberScroll(top);
        // A linha sob o mouse pode sair da tela sem avisar; a prévia do destaque não pode ficar presa.
        onPreview(null);
      }}
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
  lit: Set<string> | null;
  activeRef: Highlight | null;
  overview: RepoOverview | undefined;
  onOpen: (hash: string) => void;
  onPick: (hash: string, ref: Ref) => void;
  onPreview: (highlight: Highlight | null) => void;
}

function CommitRow(props: RowProps) {
  const { index, commit, row, lanes, isHead, selected, entering, fresh, lit, activeRef, overview, onOpen, onPick, onPreview } = props;
  const inPath = !lit || lit.has(commit.hash);
  const badge = aheadBadge(commit, overview);
  const classes = ['row'];
  if (selected) classes.push('selected');
  if (entering) classes.push('enter');
  if (fresh) classes.push('fresh');
  if (!inPath) classes.push('dim');

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
      <GraphCell row={row} lanes={lanes} height={ROW_HEIGHT} isHead={isHead} lit={lit} inPath={inPath} />
      <Avatar name={commit.authorName} email={commit.authorEmail} />
      <div class="row-text">
        <div class="row-line">
          <span class="row-subject">{commit.subject || <span class="muted">(sem mensagem)</span>}</span>
          {badge && (
            <span class="ahead" title={badge.title}>
              {badge.text}
            </span>
          )}
        </div>
        <div class="row-meta">
          <span class="row-author">
            {commit.authorName} · {timeAgo(commit.date)}
          </span>
          <RefChips
            refs={commit.refs}
            active={activeRef}
            onPick={(ref) => onPick(commit.hash, ref)}
            onHover={(ref) => onPreview(ref ? { hash: commit.hash, name: ref.name, type: ref.type } : null)}
          />
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

interface NoticeProps {
  state: RepoState;
  onRetry: () => void;
  /** `null` quando a lista já mostra todas as branches. */
  onShowAll: (() => void) | null;
}

function StateNotice({ state, onRetry, onShowAll }: NoticeProps) {
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
    case 'parentRepo':
      return (
        <div class="empty">
          <span class="empty-title">O Git deste projeto está numa pasta acima</span>
          <span>
            A pasta aberta fica dentro de outro projeto com Git, em <strong style={{ overflowWrap: 'anywhere' }}>{state.root}</strong>. Mostre o histórico
            dele só se você conhece e confia nessa pasta.
          </span>
          <button type="button" onClick={() => vscode.postMessage({ type: 'openParentRepo', always: false })}>
            Mostrar o histórico
          </button>
          <button
            type="button"
            class="ghost small-button"
            title="Vale só para o Visual Git. Para voltar a perguntar, mude a configuração visualGit.parentFolderRepos para ask."
            onClick={() => vscode.postMessage({ type: 'openParentRepo', always: true })}
          >
            Sempre abrir sem perguntar
          </button>
        </div>
      );
    case 'gitMissing':
      return (
        <div class="empty">
          <span class="empty-title">Git não encontrado</span>
          <span>Instale o Git e reabra o VS Code.</span>
          {/* O VS Code abre links http(s) da tela no navegador. */}
          <a href="https://git-scm.com/downloads">Baixar o Git (git-scm.com)</a>
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
          <button type="button" onClick={onRetry}>
            Tentar de novo
          </button>
          {onShowAll && (
            <button type="button" class="ghost small-button" title="Volta a lista para todas as branches" onClick={onShowAll}>
              Mostrar todas as branches
            </button>
          )}
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

function ChevronIcon() {
  return (
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg class="summary-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M8 7.2v3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="8" cy="4.9" r="0.85" fill="currentColor" />
    </svg>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
