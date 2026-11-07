// Calcula o desenho do grafo: em qual trilho (coluna) cada commit fica e quais linhas
// passam por cada linha da lista. Não desenha nada; só produz números para a tela usar.
//
// Ideia: percorremos os commits do mais novo para o mais antigo. Cada trilho é uma ligação
// "filho → pai" que ainda não terminou: ele "espera" pelo pai. Quando o pai chega, todas as
// ligações que esperavam por ele convergem para a bolinha dele.
//
// A branch principal (main) tem o trilho 0 reservado, então ela é sempre a linha da esquerda
// e as outras branches saem dela e voltam para ela.

export interface Segment {
  /** Trilho de onde a linha sai. */
  from: number;
  /** Trilho onde a linha chega. */
  to: number;
  /** Índice da cor na paleta. */
  color: number;
  /** Commit "filho" desta ligação (o de cima). Serve para acender só o caminho de uma branch. */
  child: string;
}

export interface GraphRow {
  /** Trilho onde fica a bolinha do commit. */
  col: number;
  /** Cor da bolinha. */
  color: number;
  /** Linhas da metade de cima (do topo da linha até a bolinha). */
  top: Segment[];
  /** Linhas da metade de baixo (da bolinha até o fim da linha). */
  bottom: Segment[];
  /** Quantos trilhos esta linha usa (para calcular a largura do grafo). */
  width: number;
  /** Commit de junção (merge): tem mais de um pai. */
  isMerge: boolean;
}

export interface LayoutState {
  /** Por trilho: o commit (pai) que ele está esperando. */
  lanes: (string | null)[];
  /** Por trilho: o commit (filho) de onde a ligação saiu. */
  children: (string | null)[];
  colors: number[];
  nextColor: number;
  /** Próximo commit esperado na linha principal (trilho 0). `null` quando não há linha principal. */
  mainNext: string | null;
  /** Se existe uma linha principal: a cor 0 fica reservada para ela. */
  hasMain: boolean;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
}

export const PALETTE_SIZE = 8;
/** Cor da linha principal. */
export const MAIN_COLOR = 0;

/** @param mainTip ponta da branch principal, que fica fixa no trilho 0. */
export function createLayoutState(mainTip: string | null = null): LayoutState {
  return { lanes: [], children: [], colors: [], nextColor: 0, mainNext: mainTip, hasMain: mainTip !== null };
}

/** Primeiro trilho livre. O trilho 0 fica guardado enquanto a linha principal não terminou. */
function firstFree(state: LayoutState): number {
  const start = state.mainNext !== null ? 1 : 0;
  for (let i = start; i < state.lanes.length; i++) {
    if (state.lanes[i] == null) return i;
  }
  for (let i = state.lanes.length; i < start; i++) state.lanes[i] = null;
  return Math.max(start, state.lanes.length);
}

function takeColor(state: LayoutState): number {
  const n = state.nextColor;
  state.nextColor += 1;
  // Com linha principal, as outras branches giram pelas cores 1..7 e a 0 fica só para ela.
  return state.hasMain ? 1 + (n % (PALETTE_SIZE - 1)) : n % PALETTE_SIZE;
}

function open(state: LayoutState, lane: number, parent: string, child: string, color: number): void {
  state.lanes[lane] = parent;
  state.children[lane] = child;
  state.colors[lane] = color;
}

/**
 * Calcula as linhas do grafo para uma página de commits.
 * `state` é atualizado, então a próxima página continua exatamente de onde esta parou.
 * Os commits precisam vir com os filhos antes dos pais (o `git log --date-order` garante isso).
 */
export function layoutCommits(commits: GraphCommit[], state: LayoutState): GraphRow[] {
  const rows: GraphRow[] = [];
  const { lanes, children, colors } = state;

  for (const commit of commits) {
    const onMain = state.mainNext === commit.hash;
    let col: number;
    let nodeColor: number;
    if (onMain) {
      col = 0;
      nodeColor = MAIN_COLOR;
    } else {
      col = lanes.indexOf(commit.hash);
      if (col === -1) {
        // Ponta de uma branch: ninguém esperava por este commit, então ele ganha trilho e cor novos.
        col = firstFree(state);
        nodeColor = takeColor(state);
      } else {
        nodeColor = colors[col] ?? 0;
      }
    }

    // ---- Metade de cima: tudo que vem da linha anterior.
    const top: Segment[] = [];
    const passing: number[] = [];
    for (let j = 0; j < lanes.length; j++) {
      const waitingFor = lanes[j];
      if (waitingFor == null) continue;
      const segment = { from: j, color: colors[j] ?? 0, child: children[j] ?? '' };
      if (waitingFor === commit.hash) {
        // Ligações que esperavam por este commit convergem para a bolinha.
        top.push({ ...segment, to: col });
        lanes[j] = null;
        children[j] = null;
      } else {
        top.push({ ...segment, to: j });
        passing.push(j);
      }
    }

    // ---- Metade de baixo: da bolinha para os pais, mais os trilhos que só passam.
    const bottom: Segment[] = [];
    const [firstParent, ...otherParents] = commit.parents;
    if (onMain) state.mainNext = firstParent ?? null;
    if (firstParent !== undefined) {
      // O primeiro pai continua no mesmo trilho e com a mesma cor: é a "linha" da branch.
      // Mesmo que outro trilho já espere por ele, cada ligação segue separada até o pai,
      // para dar para ver de onde a branch saiu.
      open(state, col, firstParent, commit.hash, nodeColor);
      bottom.push({ from: col, to: col, color: nodeColor, child: commit.hash });
    }

    for (const parent of otherParents) {
      // Merge: cada pai extra é outra linha de trabalho chegando, com trilho próprio.
      const lane = firstFree(state);
      const color = parent === state.mainNext ? MAIN_COLOR : takeColor(state);
      open(state, lane, parent, commit.hash, color);
      bottom.push({ from: col, to: lane, color, child: commit.hash });
    }

    for (const j of passing) {
      bottom.push({ from: j, to: j, color: colors[j] ?? 0, child: children[j] ?? '' });
    }

    // Remove trilhos vazios do final, para o grafo não ficar largo à toa.
    while (lanes.length > 0 && lanes[lanes.length - 1] == null) {
      lanes.pop();
      children.pop();
    }

    let width = col + 1;
    for (const segment of top) width = Math.max(width, segment.from + 1, segment.to + 1);
    for (const segment of bottom) width = Math.max(width, segment.from + 1, segment.to + 1);

    rows.push({ col, color: nodeColor, top, bottom, width, isMerge: commit.parents.length > 1 });
  }

  return rows;
}

/** O que uma linha desenha quando o grafo é cortado num número máximo de trilhos. */
export interface FittedRow {
  /** Trilho onde a bolinha é desenhada (o último visível, se o real ficar além do corte). */
  col: number;
  top: Segment[];
  bottom: Segment[];
  /** O commit está num trilho além do corte: a bolinha foi trazida para a borda. */
  overflow: boolean;
}

/**
 * Ajusta uma linha para caber em `lanes` trilhos. Se o commit está além do corte, a bolinha vai para
 * o último trilho visível e as ligações que chegam nela ou saem dela passam a terminar ali (vindo de
 * fora / indo para fora pela borda direita). As outras linhas além do corte continuam fora da área.
 */
export function fitRow(row: GraphRow, lanes: number): FittedRow {
  const last = Math.max(1, lanes) - 1;
  if (row.col <= last) return { col: row.col, top: row.top, bottom: row.bottom, overflow: false };
  return {
    col: last,
    top: row.top.map((segment) => (segment.to === row.col ? { ...segment, to: last } : segment)),
    bottom: row.bottom.map((segment) => (segment.from === row.col ? { ...segment, from: last } : segment)),
    overflow: true,
  };
}

/**
 * Todos os commits que fazem parte do histórico de `tip` (ele e seus antecessores),
 * entre os commits já carregados. É o "caminho" acendido quando se destaca uma branch.
 */
export function ancestorsOf(tip: string, commits: GraphCommit[]): Set<string> {
  const parentsOf = new Map(commits.map((c) => [c.hash, c.parents]));
  const result = new Set<string>();
  const stack = [tip];
  while (stack.length > 0) {
    const hash = stack.pop()!;
    if (result.has(hash) || !parentsOf.has(hash)) continue;
    result.add(hash);
    for (const parent of parentsOf.get(hash)!) stack.push(parent);
  }
  return result;
}
