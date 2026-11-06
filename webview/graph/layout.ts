// Calcula o desenho do grafo: em qual trilho (coluna) cada commit fica e quais linhas
// passam por cada linha da lista. Não desenha nada; só produz números para a tela usar.
//
// Ideia: percorremos os commits do mais novo para o mais antigo. Cada trilho "espera"
// por um commit (o pai do último commit que passou por ele). Quando o commit esperado
// chega, ele ocupa aquele trilho e passa a esperar pelo seu próprio pai.

export interface Segment {
  /** Trilho de onde a linha sai. */
  from: number;
  /** Trilho onde a linha chega. */
  to: number;
  /** Índice da cor na paleta. */
  color: number;
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
  lanes: (string | null)[];
  colors: number[];
  nextColor: number;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
}

export const PALETTE_SIZE = 8;

export function createLayoutState(): LayoutState {
  return { lanes: [], colors: [], nextColor: 0 };
}

function firstFree(lanes: (string | null)[]): number {
  const index = lanes.indexOf(null);
  return index === -1 ? lanes.length : index;
}

function takeColor(state: LayoutState): number {
  const color = state.nextColor % PALETTE_SIZE;
  state.nextColor += 1;
  return color;
}

/**
 * Calcula as linhas do grafo para uma página de commits.
 * `state` é atualizado, então a próxima página continua exatamente de onde esta parou.
 * Os commits precisam vir com os filhos antes dos pais (o `git log --date-order` garante isso).
 */
export function layoutCommits(commits: GraphCommit[], state: LayoutState): GraphRow[] {
  const rows: GraphRow[] = [];
  const { lanes, colors } = state;

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    const expected = col !== -1;
    if (!expected) {
      // Ponta de uma branch: ninguém esperava por este commit, então ele abre um trilho novo.
      col = firstFree(lanes);
      lanes[col] = commit.hash;
      colors[col] = takeColor(state);
    }

    // ---- Metade de cima: tudo que vem da linha anterior.
    const top: Segment[] = [];
    const passing: number[] = [];
    for (let j = 0; j < lanes.length; j++) {
      const waitingFor = lanes[j];
      if (waitingFor == null) continue;
      const color = colors[j] ?? 0;
      if (waitingFor === commit.hash) {
        // Trilhos que esperavam por este commit convergem para a bolinha.
        if (j !== col || expected) top.push({ from: j, to: col, color });
        if (j !== col) lanes[j] = null;
      } else {
        top.push({ from: j, to: j, color });
        passing.push(j);
      }
    }

    const nodeColor = colors[col] ?? 0;

    // ---- Metade de baixo: da bolinha para os pais, mais os trilhos que só passam.
    const bottom: Segment[] = [];
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent === undefined) {
      lanes[col] = null; // primeiro commit da história: a linha termina aqui
    } else {
      const existing = lanes.indexOf(firstParent);
      if (existing !== -1 && existing !== col) {
        // O pai já é esperado em outro trilho: a linha vai até lá e este trilho acaba.
        bottom.push({ from: col, to: existing, color: colors[existing] ?? 0 });
        lanes[col] = null;
      } else {
        lanes[col] = firstParent;
        bottom.push({ from: col, to: col, color: nodeColor });
      }
    }

    for (const parent of otherParents) {
      let lane = lanes.indexOf(parent);
      if (lane === -1) {
        lane = firstFree(lanes);
        lanes[lane] = parent;
        colors[lane] = takeColor(state);
      }
      bottom.push({ from: col, to: lane, color: colors[lane] ?? 0 });
    }

    for (const j of passing) {
      bottom.push({ from: j, to: j, color: colors[j] ?? 0 });
    }

    // Remove trilhos vazios do final, para o grafo não ficar largo à toa.
    while (lanes.length > 0 && lanes[lanes.length - 1] == null) lanes.pop();

    let width = col + 1;
    for (const segment of [...top, ...bottom]) width = Math.max(width, segment.from + 1, segment.to + 1);

    rows.push({ col, color: nodeColor, top, bottom, width, isMerge: commit.parents.length > 1 });
  }

  return rows;
}
