/** Com palavras ("ontem", "anteontem"): usado em minutos, horas e dias, que seguem o relógio/calendário. */
const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
/**
 * Sempre com número ("há 1 semana", "há 1 mês", "há 1 ano"): semanas, meses e anos são contados em
 * dias, então "semana passada"/"mês passado"/"ano passado" (palavras de calendário) podiam estar errados.
 */
const counted = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'always' });
const absolute = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Quantos dias do calendário (no fuso de quem vê) separam as duas datas: ontem = 1, anteontem = 2. */
function calendarDays(from: number, to: number): number {
  const start = new Date(from);
  const end = new Date(to);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  // Arredonda porque um dia com horário de verão tem 23 ou 25 horas.
  return Math.round((endDay - startDay) / (DAY * 1000));
}

/**
 * "há 3 dias", "ontem", "há 1 semana", "agora mesmo"...
 * A unidade é escolhida pelo valor já arredondado (59 min 40 s vira "há 1 hora", não "há 60 minutos").
 * "ontem"/"anteontem" seguem o calendário: um commit de anteontem às 22h, visto hoje às 8h, é
 * "anteontem", mesmo tendo só 34 horas. Data no futuro (relógio errado no computador de quem fez o
 * commit) vira "agora mesmo"; a data exata continua nos detalhes.
 */
export function timeAgo(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const seconds = (now - time) / 1000;
  if (seconds < MINUTE) return 'agora mesmo';
  const minutes = Math.round(seconds / MINUTE);
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.round(seconds / HOUR);
  if (hours < 24) return relative.format(-hours, 'hour');
  // Pelo menos 1: perto da meia-noite, 23 h 40 min ainda podem ser o mesmo dia do calendário.
  const days = Math.max(1, calendarDays(time, now));
  if (days < 7) return relative.format(-days, 'day');
  const weeks = Math.round(days / 7);
  if (days < 30) return counted.format(-weeks, 'week');
  const months = Math.round(days / 30.44);
  if (months < 12) return counted.format(-Math.max(1, months), 'month');
  return counted.format(-Math.max(1, Math.round(days / 365.25)), 'year');
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

const numbers = new Intl.NumberFormat('pt-BR');

/** Número com separador de milhar: 1834 -> "1.834". */
export function formatCount(value: number): string {
  return numbers.format(value);
}

/** "1 arquivo", "1.834 arquivos". */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Caracteres invisíveis que mudam a direção do texto (U+202A–U+202E e U+2066–U+2069). Num nome de
 * branch, autor ou arquivo eles fazem o texto aparecer embaralhado (um nome pode parecer outro, ou
 * ter outra extensão) e bagunçam a frase em volta.
 */
const DIRECTION_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

/** Troca os caracteres de direção por um código visível: "a\u202Eb" vira "a<U+202E>b". */
export function showControls(text: string): string {
  return text.replace(DIRECTION_CONTROLS, (char) => `<U+${char.charCodeAt(0).toString(16).toUpperCase()}>`);
}

/**
 * Para pôr um nome no meio de uma frase nossa dentro de texto puro (dica, opção de lista), onde não
 * dá para usar `<bdi>`: mostra os caracteres de direção e isola o nome (U+2068 … U+2069), para um
 * nome em árabe/hebraico não puxar números e pontuação da frase para o lado errado.
 */
export function isolate(text: string): string {
  return `\u2068${showControls(text)}\u2069`;
}
