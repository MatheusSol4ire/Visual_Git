import * as vscode from 'vscode';
import { isAllFilter, keptFilter, pickBase, resolveFilter, type BranchList } from '../git/branches.ts';
import {
  isCommitHash,
  MAX_SKIP,
  readAllBranchStatus,
  readBranches,
  readBranchStatus,
  readCommits,
  readHead,
  type Repo,
} from '../git/gitClient.ts';
import type { RepoService } from '../repo/RepoService.ts';
import { getMotionMode, onDidChangeMotion } from '../settings.ts';
import type { BranchStatus, FromCommitsView, RepoOverview, ToCommitsView } from '../shared/protocol.ts';
import { renderWebviewHtml, webviewRoots } from './html.ts';
import { PageRequests } from './pageRequests.ts';

const PAGE_SIZE = 300;
const MAX_RELOAD = 5000;
/** Quantas pontas de branch comparamos com a principal a cada recarga. */
const MAX_STATUS = 60;

/** A lista de commits com o grafo, na barra lateral do Visual Git. */
export class CommitsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'visualGit.commits';

  private readonly extensionUri: vscode.Uri;
  private readonly repos: RepoService;
  private readonly onOpenCommit: (hash: string) => void;
  private view: vscode.WebviewView | undefined;
  /**
   * Comparações já feitas ou em andamento ("principal:ponta" → status). Commits não mudam, então o
   * resultado vale para sempre. Guarda a promessa: duas recargas seguidas não comparam a mesma ponta
   * duas vezes. Comparação que falha sai do cache (tenta de novo na próxima recarga).
   */
  private readonly statusCache = new Map<string, Promise<BranchStatus>>();
  /** Comparação de todas as pontas num comando só, em andamento (por principal). */
  private readonly allStatusRunning = new Map<string, Promise<void>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, repos: RepoService, onOpenCommit: (hash: string) => void) {
    this.extensionUri = extensionUri;
    this.repos = repos;
    this.onOpenCommit = onOpenCommit;
    this.disposables.push(
      repos.onDidChange(() => this.post({ type: 'changed' })),
      onDidChangeMotion((motion) => this.post({ type: 'settings', motion })),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // enableForms: false — a tela não tem formulários (por padrão o VS Code os libera junto com os scripts).
    view.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: webviewRoots(this.extensionUri) };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'commits', getMotionMode(), 'Commits');
    // As respostas vão só para a view que pediu: se ela foi descartada e outra criada no lugar
    // (ex.: arrastada para outro painel), a nova não recebe respostas de pedidos da antiga.
    const reply = (message: ToCommitsView) => {
      if (this.view === view) void view.webview.postMessage(message);
    };
    const requests = new PageRequests();
    const listeners = [
      view.webview.onDidReceiveMessage((message: FromCommitsView) => this.onMessage(message, reply, requests)),
    ];
    listeners.push(
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
        requests.cancelAll();
        for (const listener of listeners.splice(0)) listener.dispose();
      }),
    );
  }

  /** Destaca um commit na lista (ex.: quando a aba de detalhes navega para outro). */
  select(hash: string): void {
    this.post({ type: 'select', hash });
  }

  private async onMessage(
    message: FromCommitsView,
    reply: (message: ToCommitsView) => void,
    requests: PageRequests,
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        reply({ type: 'settings', motion: getMotionMode() });
        break;
      case 'load': {
        // O teto é o que o Git aceita no --skip (o readCommits também confere).
        const skip = clamp(message.skip, 0, MAX_SKIP);
        const limit = skip === 0 ? clamp(message.count, PAGE_SIZE, MAX_RELOAD) : PAGE_SIZE;
        const gen = typeof message.gen === 'number' ? message.gen : 0;
        // Pedidos de listas que a tela já descartou (recarga, outro filtro) param aqui.
        const request = requests.start(gen);
        try {
          await this.sendPage(reply, gen, message.filter, skip, limit, request.signal);
        } finally {
          request.done();
        }
        break;
      }
      case 'openCommit':
        if (isCommitHash(message.hash)) this.onOpenCommit(message.hash);
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder');
        break;
      case 'openSourceControl':
        // Comando fixo, sem nada vindo da tela.
        await vscode.commands.executeCommand('workbench.view.scm');
        break;
      case 'openParentRepo':
        await this.repos.allowParentRepo(message.always === true);
        break;
    }
  }

  private async sendPage(
    reply: (message: ToCommitsView) => void,
    gen: number,
    requested: unknown,
    skip: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<void> {
    const result = await this.repos.get();
    // Cancelado: a tela já não quer esta resposta (e não vai recebê-la).
    if (signal.aborted) return;
    if ('state' in result) {
      reply({ type: 'state', state: result.state, gen });
      return;
    }
    const { repo } = result;
    try {
      // "Todas as branches" não depende da lista de branches (resolveFilter sempre a mantém e o `log` é o
      // mesmo): os dois comandos rodam juntos em vez de um depois do outro. Os outros filtros precisam da
      // lista para montar o `log` e para a volta a "todas" quando a branch sumiu, então esperam por ela.
      const early = isAllFilter(requested) ? readCommits(repo, skip, limit, undefined, signal) : undefined;
      // Se o for-each-ref falhar antes, o erro dele é o mostrado; este não pode virar "erro não tratado".
      early?.catch(() => undefined);
      const list = await readBranches(repo, signal);
      const base = pickBase(list);
      const resolved = resolveFilter(requested, list, base?.ref ?? null);
      // "Carregar mais" de uma lista cuja branch sumiu (apagada, ou removida por um fetch): emendar a página
      // de outra lista daria commits repetidos e trilhos errados. A tela recarrega do começo.
      if (skip > 0 && !keptFilter(requested, resolved.filter)) {
        reply({ type: 'changed' });
        return;
      }
      let filter = resolved.filter;
      const [page, head, overview] = await Promise.all([
        early ??
        readCommits(repo, skip, limit, resolved.revisions, signal).catch((error: unknown) => {
          if (!resolved.revisions || signal.aborted) throw error;
          // Idem no "carregar mais": recarregar do começo, onde a volta para "todas" vale para a lista inteira.
          if (skip > 0) return undefined;
          // Se o filtro escolhido não funcionar, mostramos todas as branches em vez de uma tela de erro
          // (o filtro fica salvo na tela, e a tela de erro não tem a barra para trocá-lo).
          filter = { kind: 'all' };
          return readCommits(repo, skip, limit, undefined, signal);
        }),
        // O for-each-ref já marcou a branch atual. Só perguntamos ao Git quando ele não marcou nenhuma:
        // HEAD solto, ou branch que ainda não tem commits (que o for-each-ref não lista).
        list.branches.find((b) => b.current)?.name ?? readHead(repo, signal),
        skip === 0 ? this.readOverview(repo, list, base, signal) : undefined,
      ]);
      if (signal.aborted) return;
      if (!page) {
        reply({ type: 'changed' });
        return;
      }
      if (skip === 0 && page.commits.length === 0 && filter.kind === 'all') {
        reply({ type: 'state', state: { kind: 'empty', repoName: repo.name }, gen });
        return;
      }
      reply({
        type: 'commits',
        repoName: repo.name,
        head,
        commits: page.commits,
        skip,
        hasMore: page.hasMore,
        gen,
        filter,
        overview,
      });
    } catch (error) {
      if (signal.aborted) return;
      reply({ type: 'state', state: this.repos.toErrorState(error), gen });
    }
  }

  /** Branches e quanto cada ponta está à frente/atrás da principal. */
  private async readOverview(
    repo: Repo,
    list: BranchList,
    base: RepoOverview['base'],
    signal: AbortSignal,
  ): Promise<RepoOverview> {
    const status: Record<string, BranchStatus> = {};
    if (base) {
      // A branch atual vem primeiro, para nunca ficar de fora do limite.
      const ordered = [...list.branches].sort((a, b) => Number(b.current) - Number(a.current));
      const allTips = [...new Set(ordered.map((b) => b.hash))].filter((hash) => hash !== base.hash);
      if (this.statusCache.size > 2000) this.statusCache.clear();
      const key = (tip: string) => `${base.hash}:${tip}`;
      const missing = () => allTips.some((tip) => !this.statusCache.has(key(tip)));
      const collect = (tips: string[]) =>
        Promise.all(
          tips.map(async (tip) => {
            const pending = this.statusCache.get(key(tip));
            if (!pending) return;
            try {
              status[tip] = await pending;
            } catch {
              // Uma comparação que falha só deixa essa branch sem o "à frente/atrás"; a lista aparece igual.
            }
          }),
        );

      // Git ≥ 2.41: todas as branches num comando só (e sem o limite de MAX_STATUS). Se outra recarga
      // já estava perguntando, usa a resposta dela; se ainda faltar alguma (branch criada no meio),
      // pergunta de novo.
      if (missing() && (await this.compareAll(repo, base.hash)) && missing()) await this.compareAll(repo, base.hash);
      if (!missing()) {
        await collect(allTips);
        return { base, branches: list.branches, status };
      }

      // Git antigo (ou o comando único falhou): um `rev-list` por ponta, até MAX_STATUS.
      const tips = allTips.slice(0, MAX_STATUS);
      // Poucas de cada vez, para não abrir dezenas de processos do Git ao mesmo tempo.
      for (let i = 0; i < tips.length; i += 6) {
        // Pedido cancelado: não começa outras comparações (as que já começaram ficam no cache).
        if (signal.aborted) break;
        const batch = tips.slice(i, i + 6);
        for (const tip of batch) {
          if (this.statusCache.has(key(tip))) continue; // já feita, ou em andamento noutra recarga
          const pending = readBranchStatus(repo, base.hash, tip);
          this.statusCache.set(key(tip), pending);
          pending.catch(() => {
            if (this.statusCache.get(key(tip)) === pending) this.statusCache.delete(key(tip));
          });
        }
        await collect(batch);
      }
    }
    return { base, branches: list.branches, status };
  }

  /**
   * Compara todas as pontas com a principal num comando só e guarda no cache. Uma comparação dessas
   * por vez: quem chega com outra em andamento espera por ela e recebe `true` (a resposta dela pode
   * não ter as branches que surgiram depois que ela começou).
   */
  private async compareAll(repo: Repo, baseHash: string): Promise<boolean> {
    const running = this.allStatusRunning.get(baseHash);
    if (running) {
      await running;
      return true;
    }
    const promise = readAllBranchStatus(repo, baseHash)
      .then(
        (all) => {
          if (!all) return;
          for (const [tip, value] of all) this.statusCache.set(`${baseHash}:${tip}`, Promise.resolve(value));
        },
        () => undefined, // falhou: quem chamou cai no caminho de um `rev-list` por ponta
      )
      .finally(() => this.allStatusRunning.delete(baseHash));
    this.allStatusRunning.set(baseHash, promise);
    await promise;
    return false;
  }

  private post(message: ToCommitsView): void {
    void this.view?.webview.postMessage(message);
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

function clamp(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
}
