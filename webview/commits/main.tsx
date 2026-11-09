import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Commit, CommitFilter, FromCommitsView, Ref, RepoOverview, RepoState, ToCommitsView } from '../../src/shared/protocol.ts';
import { GraphCell } from '../graph/GraphCell.tsx';
import { createLayoutState, lanesFor, layoutCommits, type GraphRow, type LayoutState } from '../graph/layout.ts';
import { Avatar, RefChips } from '../shared/components.tsx';
import { fullDate, isolate, showControls, timeAgo } from '../shared/format.ts';
import { firstGen, parseSavedList, type SavedList } from '../shared/savedState.ts';
import { isToCommitsView } from '../shared/messages.ts';
import { memo } from '../shared/memo.ts';
import { useNow } from '../shared/clock.ts';
import { applyMotion, getVsCode, onHostMessage } from '../shared/vscode.ts';
import {
  aheadBadge,
  currentBranchSummary,
  currentOptionLabel,
  filterFromValue,
  filterValue,
  lostBranchName,
  sameFilter,
} from './branchText.ts';
import { followPinned, keepPreview, litCommits, sameRef, type Highlight } from './highlight.ts';
import '../styles/base.css';
import '../styles/commits.css';

const vscode = getVsCode<FromCommitsView>();

/** Altura de cada linha da lista. É o único lugar com o número: o CSS usa `var(--vg-row)`. */
const ROW_HEIGHT = 44;
document.documentElement.style.setProperty('--vg-row', `${ROW_HEIGHT}px`);
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
  /** Nome da branch escolhida em "Mostrar" que sumiu (a lista voltou para "todas"); some no "OK" ou na próxima troca de filtro. */
  const [lostBranch, setLostBranch] = useState<string | null>(null);
  const now = useNow();
  const layout = useRef<LayoutState>(createLayoutState(null, MAX_LANES));
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
          if (!sameFilter(message.filter, filterRef.current)) {
            const before = previous.kind === 'commits' ? previous.data.overview : undefined;
            setLostBranch(lostBranchName(filterRef.current, message.filter, message.overview, before));
            saveFilter(message.filter);
          }

          const continuing = message.skip > 0 && previous.kind === 'commits';
          const restored = restoring.current;
          restoring.current = false;
          if (!continuing) layout.current = createLayoutState(message.overview?.base?.hash ?? null, MAX_LANES);
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
    setLostBranch(null);
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
    setLostBranch(null);
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
      {lostBranch !== null && <LostBranchNotice name={lostBranch} onClose={() => setLostBranch(null)} />}
      <BranchSummary overview={data.overview} />
      {pinned && <HighlightBar name={pinned.name} onClear={() => setPinned(null)} />}
      <CommitList
        data={data}
        selected={selected}
        entering={entering}
        fresh={fresh}
        highlight={preview ?? pinned}
        now={now}
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
      <span class="header-repo" title={`Projeto: ${isolate(repoName)}`}>
        {showControls(repoName)}
      </span>
      <span
        class="header-branch"
        title={
          head
            ? `Você está na branch ${isolate(head)}`
            : 'Você está vendo um commit fora de qualquer branch. Para voltar, troque para uma branch (ex.: main) na barra de status, no canto inferior esquerdo. Commits feitos agora não ficam em nenhuma branch.'
        }
      >
        <BranchIcon />
        <span class="header-branch-name">{head ? showControls(head) : 'fora de uma branch'}</span>
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
  const together = baseName ? ` (junto com a ${isolate(baseName)})` : '';

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
                <option key={b.ref} value={filterValue({ kind: 'branch', ref: b.ref })}>
                  {showControls(b.name)}
                </option>
              ))}
            </optgroup>
          )}
          {remote.length > 0 && (
            <optgroup label={`No servidor${together}`}>
              {remote.map((b) => (
                <option key={b.ref} value={filterValue({ kind: 'branch', ref: b.ref })}>
                  {showControls(b.name)}
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
  const { ahead, aheadTip, behind } = currentBranchSummary(overview);
  if (!ahead && !behind) return null;
  return (
    <div class="summary" role="status">
      <InfoIcon />
      <span>
        {ahead && <span title={aheadTip ?? undefined}>{ahead}</span>}
        {ahead && behind && ' '}
        {behind}
      </span>
    </div>
  );
}

/** A branch escolhida em "Mostrar" sumiu e a lista voltou sozinha para "todas": diz por quê. */
function LostBranchNotice({ name, onClose }: { name: string; onClose: () => void }) {
  return (
    <div class="lost-branch" role="status">
      <span class="lost-branch-text">
        A branch{' '}
        <strong>
          <bdi>{showControls(name)}</bdi>
        </strong>{' '}
        não existe mais. Mostrando todas as branches.
      </span>
      <button type="button" class="ghost small-button" onClick={onClose}>
        OK
      </button>
    </div>
  );
}

function HighlightBar({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <div class="highlight-bar" role="status">
      <span class="highlight-text">
        Destacando os commits que fazem parte de{' '}
        <strong>
          <bdi>{showControls(name)}</bdi>
        </strong>
        . Os apagados não estão nela.
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
  /** Hora usada no "há N minutos" (muda a cada minuto). */
  now: number;
  onSelect: (hash: string) => void;
  onOpen: (hash: string) => void;
  onLoadMore: (skip: number) => void;
  onPick: (hash: string, ref: Ref) => void;
  onPreview: (highlight: Highlight | null) => void;
  onClearHighlight: () => void;
}

/** Lista "virtualizada": só desenha as linhas que estão na tela, então aguenta milhares de commits. */
function CommitList(props: ListProps) {
  const { data, selected, entering, fresh, highlight, now, onSelect, onOpen, onLoadMore, onPick, onPreview, onClearHighlight } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  /**
   * Último "carregar mais" pedido: de qual lista (gen) e a partir de onde. Lista nova (recarga ou
   * outro filtro) libera o próximo, mesmo que um pedido da lista antiga tenha sido descartado.
   */
  const requested = useRef({ gen: data.gen, skip: -1 });
  const { commits, rows, hasMore, overview } = data;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  // Largura do grafo: a das linhas desenhadas (tela + folga), não a do histórico inteiro; um trecho
  // largo lá embaixo não rouba espaço do título no topo. Para o texto não ficar indo e voltando, a
  // largura só cresce enquanto a pessoa rola esta lista; volta a ser a da tela quando chega uma
  // lista nova (recarga ou outro filtro, que mudam o `gen`).
  const wanted = useMemo(() => lanesFor(rows, first, last, MAX_LANES), [rows, first, last]);
  const [widest, setWidest] = useState({ gen: data.gen, lanes: wanted });
  const lanes = widest.gen === data.gen ? Math.max(widest.lanes, wanted) : wanted;
  useEffect(() => {
    if (widest.gen !== data.gen || widest.lanes !== lanes) setWidest({ gen: data.gen, lanes });
  }, [data.gen, lanes]);

  const headHash = useMemo(() => commits.find((c) => c.refs.some((r) => r.current || r.type === 'head'))?.hash, [commits]);
  const lit = useMemo(() => litCommits(highlight, commits), [highlight?.hash, commits]);
  // Só procura de novo quando a seleção ou a lista mudam (não a cada evento de rolagem).
  const selectedIndex = useMemo(() => (selected ? commits.findIndex((c) => c.hash === selected) : -1), [selected, commits]);
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
    } else if ((event.key === 'Enter' || event.key === ' ') && selected && selectedIndex >= 0) {
      event.preventDefault();
      onOpen(selected);
    }
  };

  // Total para o leitor de tela ("5 de 300"): só as linhas perto da tela existem, então ele não consegue
  // contar sozinho. -1 = total ainda desconhecido (há mais commits para carregar).
  const setSize = hasMore ? -1 : commits.length;
  const visible = [];
  for (let i = first; i < last; i++) {
    const commit = commits[i];
    const row = rows[i];
    if (!commit || !row) continue;
    visible.push(
      <CommitRow
        key={commit.hash}
        index={i}
        setSize={setSize}
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
        now={now}
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
      // Só aponta para a linha selecionada se ela estiver desenhada (a lista só desenha o que está perto da tela).
      aria-activedescendant={selected && selectedIndex >= first && selectedIndex < last ? `commit-${selected}` : undefined}
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
  /** Total de commits da lista para o leitor de tela; -1 = ainda não se sabe. */
  setSize: number;
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
  now: number;
  onOpen: (hash: string) => void;
  onPick: (hash: string, ref: Ref) => void;
  onPreview: (highlight: Highlight | null) => void;
}

/**
 * Uma linha da lista. Com `memo`, rolar não redesenha as linhas que continuam na tela: todas as
 * propriedades são estáveis entre um evento de rolagem e outro (objetos guardados, `lit` em useMemo,
 * funções com useCallback ou o próprio `setState`). Quem acrescentar uma propriedade aqui precisa
 * manter isso, senão toda linha volta a ser redesenhada a cada rolagem.
 */
const CommitRow = memo(function CommitRow(props: RowProps) {
  const { index, setSize, commit, row, lanes, isHead, selected, entering, fresh, lit, activeRef, overview, now, onOpen, onPick, onPreview } = props;
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
      aria-posinset={index + 1}
      aria-setsize={setSize}
      style={{
        top: `${index * ROW_HEIGHT}px`,
        animationDelay: entering ? `${Math.min(index, 14) * 22}ms` : undefined,
      }}
      onClick={() => onOpen(commit.hash)}
    >
      <GraphCell row={row} lanes={lanes} height={ROW_HEIGHT} isHead={isHead} lit={lit} inPath={inPath} />
      <Avatar name={commit.authorName} email={commit.authorEmail} />
      {/* A dica fica no texto, não na linha: no `option` ela virava descrição e o leitor de tela lia o título duas vezes. */}
      <div class="row-text" title={`${commit.subject}\n${isolate(commit.authorName)} · ${fullDate(commit.date)}`}>
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
            <bdi>{showControls(commit.authorName)}</bdi> · {timeAgo(commit.date, now)}
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
});

function Skeleton() {
  return (
    <div class="layout" aria-busy="true">
      <span class="sr-only" role="status">
        Carregando commits…
      </span>
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
            A pasta aberta fica dentro de outro projeto com Git, em <strong style={{ overflowWrap: 'anywhere' }}>
              <bdi>{showControls(state.root)}</bdi>
            </strong>. Mostre o histórico
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
          <span>
            O projeto <bdi>{showControls(state.repoName)}</bdi> ainda não tem commits. Para fazer o primeiro, use a área
            Controle do Código-Fonte (Ctrl+Shift+G).
          </span>
          <button type="button" onClick={() => vscode.postMessage({ type: 'openSourceControl' })}>
            Abrir Controle do Código-Fonte
          </button>
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
