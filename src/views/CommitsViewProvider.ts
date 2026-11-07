import * as vscode from 'vscode';
import { keptFilter, pickBase, resolveFilter, type BranchList } from '../git/branches.ts';
import { isCommitHash, readBranches, readBranchStatus, readCommits, readHead, type Repo } from '../git/gitClient.ts';
import type { RepoService } from '../repo/RepoService.ts';
import { getMotionMode } from '../settings.ts';
import type { BranchStatus, FromCommitsView, RepoOverview, ToCommitsView } from '../shared/protocol.ts';
import { renderWebviewHtml, webviewRoots } from './html.ts';

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
  /** Comparações já feitas ("principal:ponta" → status). Commits não mudam, então o resultado vale para sempre. */
  private readonly statusCache = new Map<string, BranchStatus>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, repos: RepoService, onOpenCommit: (hash: string) => void) {
    this.extensionUri = extensionUri;
    this.repos = repos;
    this.onOpenCommit = onOpenCommit;
    this.disposables.push(
      repos.onDidChange(() => this.post({ type: 'changed' })),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('visualGit.animations') || event.affectsConfiguration('workbench.reduceMotion')) {
          this.post({ type: 'settings', motion: getMotionMode() });
        }
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: webviewRoots(this.extensionUri) };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'commits', getMotionMode(), 'Commits');
    // As respostas vão só para a view que pediu: se ela foi descartada e outra criada no lugar
    // (ex.: arrastada para outro painel), a nova não recebe respostas de pedidos da antiga.
    const reply = (message: ToCommitsView) => {
      if (this.view === view) void view.webview.postMessage(message);
    };
    const listeners = [
      view.webview.onDidReceiveMessage((message: FromCommitsView) => this.onMessage(message, reply)),
    ];
    listeners.push(
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
        for (const listener of listeners.splice(0)) listener.dispose();
      }),
    );
  }

  /** Destaca um commit na lista (ex.: quando a aba de detalhes navega para outro). */
  select(hash: string): void {
    this.post({ type: 'select', hash });
  }

  /** Pede para a tela recarregar mantendo o que já foi carregado. */
  refresh(): void {
    this.post({ type: 'changed' });
  }

  private async onMessage(message: FromCommitsView, reply: (message: ToCommitsView) => void): Promise<void> {
    switch (message.type) {
      case 'ready':
        reply({ type: 'settings', motion: getMotionMode() });
        break;
      case 'load': {
        const skip = clamp(message.skip, 0, Number.MAX_SAFE_INTEGER);
        const limit = skip === 0 ? clamp(message.count, PAGE_SIZE, MAX_RELOAD) : PAGE_SIZE;
        const gen = typeof message.gen === 'number' ? message.gen : 0;
        await this.sendPage(reply, gen, message.filter, skip, limit);
        break;
      }
      case 'openCommit':
        if (isCommitHash(message.hash)) this.onOpenCommit(message.hash);
        break;
      case 'openFolder':
        await vscode.commands.executeCommand('vscode.openFolder');
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
  ): Promise<void> {
    const result = await this.repos.get();
    if ('state' in result) {
      reply({ type: 'state', state: result.state, gen });
      return;
    }
    const { repo } = result;
    try {
      const list = await readBranches(repo);
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
        readCommits(repo, skip, limit, resolved.revisions).catch((error: unknown) => {
          if (!resolved.revisions) throw error;
          // Idem no "carregar mais": recarregar do começo, onde a volta para "todas" vale para a lista inteira.
          if (skip > 0) return undefined;
          // Se o filtro escolhido não funcionar, mostramos todas as branches em vez de uma tela de erro
          // (o filtro fica salvo na tela, e a tela de erro não tem a barra para trocá-lo).
          filter = { kind: 'all' };
          return readCommits(repo, skip, limit);
        }),
        readHead(repo),
        skip === 0 ? this.readOverview(repo, list, base) : undefined,
      ]);
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
      reply({ type: 'state', state: this.repos.toErrorState(error), gen });
    }
  }

  /** Branches e quanto cada ponta está à frente/atrás da principal. */
  private async readOverview(repo: Repo, list: BranchList, base: RepoOverview['base']): Promise<RepoOverview> {
    const status: Record<string, BranchStatus> = {};
    if (base) {
      // A branch atual vem primeiro, para nunca ficar de fora do limite.
      const ordered = [...list.branches].sort((a, b) => Number(b.current) - Number(a.current));
      const tips = [...new Set(ordered.map((b) => b.hash))].filter((hash) => hash !== base.hash).slice(0, MAX_STATUS);
      if (this.statusCache.size > 2000) this.statusCache.clear();
      // Poucas de cada vez, para não abrir dezenas de processos do Git ao mesmo tempo.
      for (let i = 0; i < tips.length; i += 6) {
        await Promise.all(
          tips.slice(i, i + 6).map(async (tip) => {
            const key = `${base.hash}:${tip}`;
            let value = this.statusCache.get(key);
            if (!value) {
              try {
                value = await readBranchStatus(repo, base.hash, tip);
              } catch {
                // Uma comparação que falha só deixa essa branch sem o "à frente/atrás"; a lista aparece igual.
                return;
              }
              this.statusCache.set(key, value);
            }
            status[tip] = value;
          }),
        );
      }
    }
    return { base, branches: list.branches, status };
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
