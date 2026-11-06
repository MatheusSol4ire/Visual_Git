import type { Ref } from '../../src/shared/protocol.ts';
import { PALETTE_SIZE } from '../graph/layout.ts';
import { colorIndexFor, initials } from './format.ts';

/** Bolinha com as iniciais da pessoa. Funciona 100% offline. */
export function Avatar({ name, email, size = 'md' }: { name: string; email: string; size?: 'md' | 'lg' }) {
  const color = colorIndexFor(email || name, PALETTE_SIZE);
  return (
    <span class={`avatar avatar-${size}`} style={{ '--c': `var(--vg-c${color})` }} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const REF_LABEL: Record<Ref['type'], string> = {
  branch: 'Branch',
  remote: 'Branch no servidor',
  tag: 'Versão (tag)',
  head: 'Você está neste commit',
};

/** Etiquetas de branch, tag e remoto. A branch atual ganha destaque. */
export function RefChips({ refs }: { refs: Ref[] }) {
  if (refs.length === 0) return null;
  return (
    <span class="refs">
      {refs.map((ref) => {
        const tip = ref.current ? 'Você está nesta branch' : REF_LABEL[ref.type];
        return (
          <span key={ref.type + ref.name} class={`ref ref-${ref.type}${ref.current ? ' ref-current' : ''}`} title={`${tip}: ${ref.name}`}>
            {ref.type === 'tag' && <TagIcon />}
            {ref.type === 'remote' && <CloudIcon />}
            {ref.name}
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
