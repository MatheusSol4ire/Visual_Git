import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorIndexFor, formatCount, fullDate, initials, isolate, plural, shortHash, showControls, timeAgo } from './format.ts';

test('iniciais do nome', () => {
  assert.equal(initials('Ana Maria Souza'), 'AS');
  assert.equal(initials('ana'), 'AN');
  assert.equal(initials('  João  '), 'JO');
  assert.equal(initials(''), '?');
  assert.equal(initials('Élio Ávila'), 'ÉÁ');
});

test('tempo relativo em português', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(timeAgo('2026-11-05T11:59:50Z', now), 'agora mesmo');
  assert.equal(timeAgo('2026-11-05T10:00:00Z', now), 'há 2 horas');
  assert.equal(timeAgo('2026-11-04T12:00:00Z', now), 'ontem');
  assert.equal(timeAgo('data inválida', now), '');
});

// Datas montadas no fuso local de quem roda o teste: "ontem"/"anteontem" seguem o calendário local.
const local = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).getTime();
const iso = (time: number) => new Date(time).toISOString();

test('tempo relativo troca de unidade depois de arredondar', () => {
  const now = local(20, 12);
  const ago = (seconds: number) => timeAgo(iso(now - seconds * 1000), now);
  assert.equal(ago(59), 'agora mesmo');
  assert.equal(ago(60), 'há 1 minuto');
  assert.equal(ago(59 * 60 + 29), 'há 59 minutos');
  assert.equal(ago(59 * 60 + 40), 'há 1 hora'); // e não "há 60 minutos"
  assert.equal(ago(23 * 3600 + 20 * 60), 'há 23 horas');
  assert.equal(ago(23 * 3600 + 45 * 60), 'ontem'); // e não "há 24 horas"
  assert.equal(timeAgo(iso(local(13, 22)), now), 'há 1 semana'); // 6 dias e 14 h: 7 dias no calendário
  assert.equal(timeAgo(iso(local(14, 12)), now), 'há 6 dias');
  assert.equal(timeAgo(iso(local(10, 12)), now), 'há 1 semana');
  assert.equal(timeAgo(iso(local(3, 12)), now), 'há 2 semanas'); // 17 dias
});

test('ontem e anteontem seguem o calendário, não as horas', () => {
  // Anteontem às 22h, visto hoje às 8h: só 34 horas, mas é anteontem.
  assert.equal(timeAgo(iso(local(18, 22)), local(20, 8)), 'anteontem');
  // Ontem à 0h, visto hoje às 23h: 47 horas, mas é ontem.
  assert.equal(timeAgo(iso(local(19, 0)), local(20, 23)), 'ontem');
  // Hoje 0h10, visto às 23h50: 23 h 40 min arredonda para 24 h, mas ainda é hoje: não diz "hoje".
  assert.equal(timeAgo(iso(local(20, 0, 10)), local(20, 23, 50)), 'ontem');
});

test('meses e anos', () => {
  const now = local(20, 12);
  const daysAgo = (days: number) => timeAgo(iso(now - days * 86_400_000), now);
  assert.equal(daysAgo(30), 'há 1 mês');
  assert.equal(daysAgo(45), 'há 1 mês'); // e não "mês passado" (45 dias atrás pode ser dois meses do calendário)
  assert.equal(daysAgo(75), 'há 2 meses');
  assert.equal(daysAgo(354), 'há 1 ano'); // e não "há 12 meses"
  assert.equal(daysAgo(364), 'há 1 ano');
  assert.equal(daysAgo(800), 'há 2 anos');
});

test('commit com data no futuro (relógio errado) vira "agora mesmo"', () => {
  const now = local(20, 12);
  assert.equal(timeAgo(iso(now + 5 * 60_000), now), 'agora mesmo');
  assert.equal(timeAgo(iso(now + 3 * 3_600_000), now), 'agora mesmo');
  assert.equal(timeAgo(iso(now + 86_400_000), now), 'agora mesmo');
});

test('a mesma pessoa sempre tem a mesma cor', () => {
  assert.equal(colorIndexFor('ana@example.com', 8), colorIndexFor('ana@example.com', 8));
  for (const key of ['a', 'b', 'ana@example.com', '']) {
    const index = colorIndexFor(key, 8);
    assert.ok(index >= 0 && index < 8);
  }
});

test('cores diferentes para pessoas diferentes, sempre dentro da paleta', () => {
  // Chaves cujo cálculo passa do limite do inteiro e fica negativo também caem na paleta.
  const indexes = new Set(['ana@example.com', 'bruno@example.com', 'carla@example.com', 'x'.repeat(50), 'zz'].map((key) => colorIndexFor(key, 8)));
  assert.ok(indexes.size > 1);
  for (const index of indexes) assert.ok(Number.isInteger(index) && index >= 0 && index < 8);
});

test('tempo relativo em semanas', () => {
  const now = local(20, 12);
  assert.equal(timeAgo(iso(local(10, 12)), now), 'há 1 semana');
  assert.equal(timeAgo(iso(local(6, 12)), now), 'há 2 semanas');
});

test('data completa', () => {
  assert.equal(fullDate(iso(local(5, 14, 32))), '5 de novembro de 2026 às 14:32');
  assert.equal(fullDate('data inválida'), '');
  assert.equal(fullDate(''), '');
});

test('código curto do commit tem 7 caracteres', () => {
  assert.equal(shortHash('0123456789abcdef0123456789abcdef01234567'), '0123456');
  assert.equal(shortHash('abc'), 'abc');
});

test('plural', () => {
  assert.equal(plural(0, 'arquivo', 'arquivos'), '0 arquivos');
  assert.equal(plural(1, 'arquivo', 'arquivos'), '1 arquivo');
  assert.equal(plural(2, 'arquivo', 'arquivos'), '2 arquivos');
  assert.equal(plural(1834, 'arquivo', 'arquivos'), '1.834 arquivos');
});

test('números com separador de milhar', () => {
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(95), '95');
  assert.equal(formatCount(1000), '1.000');
  assert.equal(formatCount(45210), '45.210');
  assert.equal(formatCount(1234567), '1.234.567');
});

test('caracteres de direção do texto ficam visíveis', () => {
  // "Trojan Source": parece "fix-exe.txt", mas o nome é outro.
  assert.equal(showControls('fix-\u202Etxt.exe'), 'fix-<U+202E>txt.exe');
  for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    const char = String.fromCharCode(code);
    assert.equal(showControls(`a${char}b${char}`), `a<U+${code.toString(16).toUpperCase()}>b<U+${code.toString(16).toUpperCase()}>`);
  }
  // Nomes comuns (inclusive em árabe/hebraico e com acentos) não mudam.
  for (const text of ['main', 'feature/login', 'João', 'מיין', 'رئيسي', '']) assert.equal(showControls(text), text);
});

test('isolate: nome no meio de uma frase de texto puro', () => {
  assert.equal(isolate('main'), '\u2068main\u2069');
  // O isolamento do dado não pode ser fechado por dentro (o U+2069 do próprio nome vira código).
  assert.equal(isolate('a\u2069b'), '\u2068a<U+2069>b\u2069');
});
