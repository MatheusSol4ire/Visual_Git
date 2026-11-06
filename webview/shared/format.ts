const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "há 3 dias", "ontem", "agora mesmo"... */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (Number.isNaN(seconds)) return '';
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'agora mesmo';
}

/** "5 de novembro de 2026 às 14:32" */
export function fullDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : absolute.format(date);
}

export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

/** "Ana Maria Souza" -> "AS"; "ana" -> "AN". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...(words[0] ?? '')];
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  const last = [...(words[words.length - 1] ?? '')];
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

/** Cor estável para uma pessoa: o mesmo e-mail sempre ganha a mesma cor. */
export function colorIndexFor(key: string, paletteSize: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % paletteSize;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
