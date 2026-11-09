import { Component } from 'preact';
import { fitRow, splitThrough, type GraphRow, type Segment } from './layout.ts';

export const LANE_WIDTH = 14;
const PADDING = 6;
const NODE_RADIUS = 4;

export function graphWidth(lanes: number): number {
  return PADDING * 2 + Math.max(1, lanes) * LANE_WIDTH;
}

function x(lane: number): number {
  return PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/** Linha de (x1,y1) até (x2,y2): reta se for no mesmo trilho, curva suave (S) se mudar de trilho. */
function path(segment: Segment, y1: number, y2: number): string {
  const x1 = x(segment.from);
  const x2 = x(segment.to);
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const middle = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2}`;
}

interface GraphCellProps {
  row: GraphRow;
  lanes: number;
  height: number;
  isHead: boolean;
  /** Quando uma branch está destacada: os commits do caminho dela. As outras linhas ficam apagadas. */
  lit: Set<string> | null;
  /** Se o commit desta linha faz parte do caminho destacado. */
  inPath: boolean;
}

/**
 * O pedaço do grafo de uma linha da lista. As linhas de cima e de baixo se encaixam com as vizinhas.
 * Só redesenha quando alguma propriedade muda: rolar a lista muda a posição das linhas, não o grafo
 * delas (sem isso, cada evento de rolagem refazia todos os `<path>` das ~46 linhas da tela).
 */
export class GraphCell extends Component<GraphCellProps> {
  override shouldComponentUpdate(next: GraphCellProps): boolean {
    const now = this.props;
    return (
      next.row !== now.row ||
      next.lanes !== now.lanes ||
      next.height !== now.height ||
      next.isHead !== now.isHead ||
      next.lit !== now.lit ||
      next.inPath !== now.inPath
    );
  }

  override render(props: GraphCellProps) {
    return drawGraphCell(props);
  }
}

function drawGraphCell({ row, lanes, height, isHead, lit, inPath }: GraphCellProps) {
  const middle = height / 2;
  const width = graphWidth(lanes);
  // Commit num trilho além do corte: a bolinha fica na borda, com uma setinha de "continua à direita".
  const fitted = fitRow(row, lanes);
  const { col, overflow } = fitted;
  // Ligação com as duas pontas além do corte nunca aparece (`overflow: hidden`): nem vira `<path>`.
  const shown = (segment: Segment) => segment.from < lanes || segment.to < lanes;
  // Trilho que só atravessa a linha vira um traço só (em duas metades, o meio ficava com um pontinho
  // mais claro quando o caminho está apagado).
  const { through, top, bottom } = splitThrough(fitted.top.filter(shown), fitted.bottom.filter(shown), col);
  const cx = x(col);
  // Uma ligação faz parte do caminho quando o commit de cima dela faz (o de baixo é antecessor dele).
  // A cor vem de uma classe (`.edge.c3` → --vg-c3), sem um objeto `style` por `<path>`.
  const edgeClass = (segment: Segment) => `edge c${segment.color}${lit && !lit.has(segment.child) ? ' edge-dim' : ''}`;

  return (
    <svg class="graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {overflow && <title>Há muitas branches em paralelo: parte do desenho foi recolhida à direita.</title>}
      {through.map((segment, i) => (
        <path key={`p${i}`} d={path(segment, 0, height)} class={edgeClass(segment)} />
      ))}
      {top.map((segment, i) => (
        <path key={`t${i}`} d={path(segment, 0, middle)} class={edgeClass(segment)} />
      ))}
      {bottom.map((segment, i) => (
        <path key={`b${i}`} d={path(segment, middle, height)} class={edgeClass(segment)} />
      ))}
      <g class={lit && !inPath ? 'node node-dim' : 'node'} style={{ '--c': `var(--vg-c${row.color})` }}>
        {isHead && <circle class="node-halo" cx={cx} cy={middle} r={NODE_RADIUS + 3.5} />}
        <circle class={row.isMerge ? 'node-dot node-merge' : 'node-dot'} cx={cx} cy={middle} r={NODE_RADIUS} />
        {overflow && <path class="node-more" d={`M${cx + NODE_RADIUS + 4.5} ${middle - 2.5}l2.5 2.5l-2.5 2.5`} />}
      </g>
    </svg>
  );
}
