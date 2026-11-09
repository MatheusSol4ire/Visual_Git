import type { Ref } from '../../src/shared/protocol.ts';
import { PALETTE_SIZE } from '../graph/layout.ts';
import { colorIndexFor, initials, isolate, showControls } from './format.ts';

/** Bolinha com as iniciais da pessoa. Funciona 100% offline. */
export function Avatar({ name, email, size = 'md' }: { name: string; email: string; size?: 'md' | 'lg' }) {
  const color = colorIndexFor(email || name, PALETTE_SIZE);
  return (
    <span class={`avatar avatar-${size}`} style={{ '--c': `var(--vg-c${color})` }} title={showControls(name)} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const REF_LABEL: Record<Ref['type'], string> = {
  branch: 'Branch',
  remote: 'Branch no servidor',
  tag: 'Versão (tag)',
  head: 'Você está neste commit, fora de qualquer branch',
};

/** No lugar do "HEAD" cru do Git (HEAD solto: o commit atual não está em nenhuma branch). */
const HEAD_TEXT = 'você está aqui';

interface RefChipsProps {
  refs: Ref[];
  /** Clique numa etiqueta (ex.: para destacar os commits da branch). */
  onPick?: (ref: Ref) => void;
  /** Mouse entrou (ref) ou saiu (null) de uma etiqueta. */
  onHover?: (ref: Ref | null) => void;
  /** Etiqueta destacada no momento (nome e tipo: uma tag e uma branch podem ter o mesmo nome). */
  active?: Pick<Ref, 'name' | 'type'> | null;
}

/** Etiquetas de branch, tag e remoto. A branch atual ganha destaque. */
export function RefChips({ refs, onPick, onHover, active }: RefChipsProps) {
  if (refs.length === 0) return null;
  return (
    <span class="refs">
      {refs.map((ref) => {
        const tip = ref.current ? 'Você está nesta branch' : REF_LABEL[ref.type];
        // O "HEAD" não é um nome que a pessoa criou: a dica já diz tudo, sem repetir o nome.
        const label = ref.type === 'head' ? tip : `${tip}: ${isolate(ref.name)}`;
        const classes = ['ref', `ref-${ref.type}`];
        if (ref.current) classes.push('ref-current');
        if (onPick) classes.push('ref-pickable');
        if (active && active.name === ref.name && active.type === ref.type) classes.push('ref-active');
        return (
          <span
            key={ref.type + ref.name}
            class={classes.join(' ')}
            title={onPick ? `${label}\nClique para ver quais commits fazem parte desta branch` : label}
            onClick={
              onPick &&
              ((event) => {
                event.stopPropagation(); // não abre o commit, só destaca
                onPick(ref);
              })
            }
            onMouseEnter={onHover && (() => onHover(ref))}
            onMouseLeave={onHover && (() => onHover(null))}
          >
            {ref.type === 'tag' && <TagIcon />}
            {ref.type === 'remote' && <CloudIcon />}
            {/* O tipo (e o "você está aqui") só aparece na dica e na cor; o leitor de tela lê a mesma dica. */}
            <span class="sr-only">{tip}: </span>
            <span class="ref-name">{ref.type === 'head' ? HEAD_TEXT : showControls(ref.name)}</span>
          </span>
        );
      })}
    </span>
  );
}

function TagIcon() {
  return (
    <svg class="ref-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2.5h5l6 6-5 5-6-6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg class="ref-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  );
}
