import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Commit, CommitFilter, RepoOverview } from '../../src/shared/protocol.ts';
import { isolate } from '../shared/format.ts';
import {
  aheadBadge,
  currentBranchSummary,
  currentOptionLabel,
  filterFromValue,
  filterValue,
  lostBranchName,
  parseSavedFilter,
  sameFilter,
} from './branchText.ts';

const MAIN = 'a'.repeat(40);
const FEAT = 'b'.repeat(40);
const REMOTE = 'c'.repeat(40);
const DONE = 'd'.repeat(40);

/** Nome como aparece nas frases: isolado do resto (ver `isolate`). */
const main = isolate('main');

/** Explicação do Squash/Rebase que acompanha o "N fora da main" (dica do selo e do resumo). */
const squash = (base: string) =>
  `Se ela já foi juntada pelo GitHub com "Squash" ou "Rebase", esse número não zera: as mudanças entraram na ${base} como commits novos.`;

const overview: RepoOverview = {
  base: { name: 'main', ref: 'refs/heads/main', hash: MAIN },
  branches: [
    { ref: 'refs/heads/main', name: 'main', type: 'branch', hash: MAIN, current: false },
    { ref: 'refs/heads/feature', name: 'feature', type: 'branch', hash: FEAT, current: true },
  ],
  status: { [FEAT]: { ahead: 3, behind: 1 }, [REMOTE]: { ahead: 2, behind: 0 }, [DONE]: { ahead: 0, behind: 4 } },
};

const commit = (hash: string, refs: Commit['refs']): Commit => ({
  hash,
  parents: [],
  authorName: 'A',
  authorEmail: 'a@example.com',
  date: '2026-01-01T00:00:00Z',
  subject: 's',
  refs,
});

/** O mesmo overview com outra comparação para a branch atual (feature). */
const withStatus = (status: RepoOverview['status'][string] | undefined): RepoOverview => ({
  ...overview,
  status: status ? { [FEAT]: status } : {},
});

test('o valor do filtro vai e volta sem perder nada', () => {
  const filters: CommitFilter[] = [{ kind: 'all' }, { kind: 'current' }, { kind: 'branch', ref: 'refs/heads/a:b' }];
  for (const filter of filters) assert.deepEqual(filterFromValue(filterValue(filter)), filter);
  assert.deepEqual(filterFromValue('qualquer coisa'), { kind: 'all' });
});

test('sameFilter diferencia duas branches (senão escolher outra branch não faria nada)', () => {
  const a: CommitFilter = { kind: 'branch', ref: 'refs/heads/a' };
  const b: CommitFilter = { kind: 'branch', ref: 'refs/heads/b' };
  assert.equal(sameFilter(a, b), false);
  assert.equal(sameFilter(a, { kind: 'branch', ref: 'refs/heads/a' }), true);
  assert.equal(sameFilter({ kind: 'all' }, { kind: 'current' }), false);
  assert.equal(sameFilter({ kind: 'all' }, { kind: 'all' }), true);
});

test('filtro salvo: formatos conhecidos voltam iguais, o resto vira "todas"', () => {
  assert.deepEqual(parseSavedFilter({ filter: { kind: 'current' } }), { kind: 'current' });
  assert.deepEqual(parseSavedFilter({ filter: { kind: 'branch', ref: 'refs/heads/x' } }), { kind: 'branch', ref: 'refs/heads/x' });
  assert.deepEqual(parseSavedFilter({ filter: { kind: 'all' } }), { kind: 'all' });
  for (const junk of [undefined, null, 'current', 42, {}, { filter: null }, { filter: 'current' }, { filter: { kind: 'branch' } }, { filter: { kind: 'branch', ref: 7 } }, { filter: { kind: 'outro' } }]) {
    assert.deepEqual(parseSavedFilter(junk), { kind: 'all' }, JSON.stringify(junk));
  }
});

test('etiqueta "fora da main" só na ponta de branch com commits a mais', () => {
  assert.deepEqual(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), overview), {
    text: `3 fora da ${main}`,
    title: `3 commits desta branch ainda não estão na ${main}. ${squash(main)}`,
  });
  // A própria main, uma tag, sem overview: nada.
  assert.equal(aheadBadge(commit(MAIN, [{ name: 'main', type: 'branch' }]), overview), null);
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'v1', type: 'tag' }]), overview), null);
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), undefined), null);
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), { ...overview, base: null }), null);
});

test('etiqueta "fora da main": branch já juntada ou sem comparação não ganha "0 fora"', () => {
  assert.equal(aheadBadge(commit(DONE, [{ name: 'velha', type: 'branch' }]), overview), null); // ahead 0
  assert.equal(aheadBadge(commit('e'.repeat(40), [{ name: 'nova', type: 'branch' }]), overview), null); // sem status
});

test('etiqueta "fora da main" também na ponta que só existe no servidor', () => {
  assert.deepEqual(aheadBadge(commit(REMOTE, [{ name: 'origin/x', type: 'remote' }]), overview), {
    text: `2 fora da ${main}`,
    title: `2 commits desta branch ainda não estão na ${main}. ${squash(main)}`,
  });
});

test('etiqueta "fora da main" no singular', () => {
  const one = { ...overview, status: { [FEAT]: { ahead: 1, behind: 0 } } };
  assert.deepEqual(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), one), {
    text: `1 fora da ${main}`,
    title: `1 commit desta branch ainda não está na ${main}. ${squash(main)}`,
  });
});

test('resumo da branch atual em linguagem simples', () => {
  assert.deepEqual(currentBranchSummary(overview), {
    ahead: `Sua branch tem 3 commits que ainda não estão na ${main}.`,
    aheadTip: squash(main),
    behind: `A ${main} tem 1 commit novo que sua branch ainda não tem.`,
  });
  assert.deepEqual(currentBranchSummary(withStatus({ ahead: 1, behind: 2 })), {
    ahead: `Sua branch tem 1 commit que ainda não está na ${main}.`,
    aheadTip: squash(main),
    behind: `A ${main} tem 2 commits novos que sua branch ainda não tem.`,
  });
  assert.deepEqual(currentBranchSummary(withStatus({ ahead: 0, behind: 0 })), { ahead: null, aheadTip: null, behind: null });
  // Só atrás: a explicação do Squash/Rebase não aparece (ela é sobre os commits a mais).
  assert.deepEqual(currentBranchSummary(withStatus({ ahead: 0, behind: 2 })), {
    ahead: null,
    aheadTip: null,
    behind: `A ${main} tem 2 commits novos que sua branch ainda não tem.`,
  });
});

test('resumo não inventa frase quando falta informação', () => {
  const empty = { ahead: null, aheadTip: null, behind: null };
  // Sem a comparação da branch atual (ex.: ela falhou), sem principal, sem overview.
  assert.deepEqual(currentBranchSummary(withStatus(undefined)), empty);
  assert.deepEqual(currentBranchSummary({ ...overview, base: null }), empty);
  assert.deepEqual(currentBranchSummary(undefined), empty);
  // Na própria main, ou numa branch na mesma ponta da main.
  const onMain = { ...overview, branches: overview.branches.map((b) => ({ ...b, current: b.ref === 'refs/heads/main' })) };
  assert.deepEqual(currentBranchSummary(onMain), empty);
  const sameTip = { ...overview, branches: overview.branches.map((b) => ({ ...b, hash: MAIN })), status: { [MAIN]: { ahead: 3, behind: 1 } } };
  assert.deepEqual(currentBranchSummary(sameTip), empty);
  // Nenhuma branch atual (HEAD solto).
  const detached = { ...overview, branches: overview.branches.map((b) => ({ ...b, current: false })) };
  assert.deepEqual(currentBranchSummary(detached), empty);
});

test('rótulo da opção "minha branch"', () => {
  assert.equal(currentOptionLabel('feature', 'main'), `Minha branch (${isolate('feature')}) e a ${main}`);
  assert.equal(currentOptionLabel('main', 'main'), `Só a minha branch (${main})`);
  assert.equal(currentOptionLabel(null, 'main'), `Este commit e a ${main}`);
  // Sem branch principal: nada de "e a null".
  assert.equal(currentOptionLabel('x', null), `Só a minha branch (${isolate('x')})`);
  assert.equal(currentOptionLabel(null, null), 'Só este commit');
});

test('nomes com caracteres de direção aparecem com o código, isolados da frase', () => {
  const tricky = 'fix‮txt.exe';
  const badge = aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), { ...overview, base: { ...overview.base!, name: tricky } });
  assert.equal(badge?.text, '3 fora da ⁨fix<U+202E>txt.exe⁩');
  assert.ok(badge?.title.endsWith('entraram na ⁨fix<U+202E>txt.exe⁩ como commits novos.'));
  assert.equal(currentOptionLabel(tricky, null), 'Só a minha branch (⁨fix<U+202E>txt.exe⁩)');
});

test('números grandes no selo e no resumo têm separador de milhar', () => {
  const many = { ...overview, status: { [FEAT]: { ahead: 1834, behind: 12000 } } };
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), many)?.text, `1.834 fora da ${main}`);
  const summary = currentBranchSummary(many);
  assert.equal(summary.ahead, `Sua branch tem 1.834 commits que ainda não estão na ${main}.`);
  assert.equal(summary.behind, `A ${main} tem 12.000 commits novos que sua branch ainda não tem.`);
});

test('aviso da branch que sumiu do filtro', () => {
  const feature: CommitFilter = { kind: 'branch', ref: 'refs/heads/feature' };
  const all: CommitFilter = { kind: 'all' };
  const gone = { ...overview, branches: overview.branches.filter((b) => b.ref !== 'refs/heads/feature') };
  // Sumiu: o nome vem da lista de antes.
  const renamed = { ...overview, branches: overview.branches.map((b) => (b.ref === 'refs/heads/feature' ? { ...b, name: 'feature-login' } : b)) };
  assert.equal(lostBranchName(feature, all, gone, renamed), 'feature-login');
  // Sem a lista de antes (tela recriada): o nome sai do nome completo, local ou do servidor.
  assert.equal(lostBranchName(feature, all, gone, undefined), 'feature');
  assert.equal(lostBranchName({ kind: 'branch', ref: 'refs/remotes/origin/x' }, all, gone, undefined), 'origin/x');
  assert.equal(lostBranchName(feature, all, undefined, undefined), 'feature');
  // A branch ainda existe (o filtro voltou para "todas" por outro motivo): ela não sumiu, sem aviso.
  assert.equal(lostBranchName(feature, all, overview, overview), null);
  // Outros filtros não geram aviso.
  assert.equal(lostBranchName(all, all, gone, overview), null);
  assert.equal(lostBranchName({ kind: 'current' }, all, gone, overview), null);
  assert.equal(lostBranchName(feature, feature, gone, overview), null);
});
