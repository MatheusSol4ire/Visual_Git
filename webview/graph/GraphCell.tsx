import type { GraphRow, Segment } from './layout.ts';

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

/** O pedaço do grafo de uma linha da lista. As linhas de cima e de baixo se encaixam com as vizinhas. */
export function GraphCell({ row, lanes, height, isHead }: { row: GraphRow; lanes: number; height: number; isHead: boolean }) {
  const middle = height / 2;
  const width = graphWidth(lanes);
  const cx = x(row.col);

  return (
    <svg class="graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {row.top.map((segment, i) => (
        <path key={`t${i}`} d={path(segment, 0, middle)} class="edge" style={{ stroke: `var(--vg-c${segment.color})` }} />
      ))}
      {row.bottom.map((segment, i) => (
        <path key={`b${i}`} d={path(segment, middle, height)} class="edge" style={{ stroke: `var(--vg-c${segment.color})` }} />
      ))}
      <g class="node" style={{ '--c': `var(--vg-c${row.color})` }}>
        {isHead && <circle class="node-halo" cx={cx} cy={middle} r={NODE_RADIUS + 3.5} />}
        <circle class={row.isMerge ? 'node-dot node-merge' : 'node-dot'} cx={cx} cy={middle} r={NODE_RADIUS} />
      </g>
    </svg>
  );
}
