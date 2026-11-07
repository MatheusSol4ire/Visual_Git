import * as vscode from 'vscode';
import { isAbsolute, join, relative } from 'node:path';
import { isCommitHash, readCommitDetails, readTreeEntry, type Repo } from '../git/gitClient.ts';
import { getBuiltInGitApi } from '../git/resolveGit.ts';
import type { RepoService } from '../repo/RepoService.ts';
import { getMotionMode } from '../settings.ts';
import type { CommitDetails, FileChange, FromDetailsView, ToDetailsView } from '../shared/protocol.ts';
import { renderWebviewHtml, webviewRoots } from './html.ts';

/** A aba com os detalhes do commit clicado. Uma só, reaproveitada a cada clique. */
export class CommitDetailsPanel implements vscode.Disposable {
  private readonly extensionUri: vscode.Uri;
  private readonly repos: RepoService;
  private readonly onNavigate: (hash: string) => void;
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private hash: string | undefined;
  private details: CommitDetails | undefined;
  /** Conta as mudanças do repositório; `details` só vale se foi lido depois da última. */
  private repoVersion = 0;
  private detailsVersion = -1;
  private repo: Repo | undefined;
  private requestId = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, repos: RepoService, onNavigate: (hash: string) => void) {
    this.extensionUri = extensionUri;
    this.repos = repos;
    this.onNavigate = onNavigate;
    this.disposables.push(
      // Merge, sincronizar, troca de branch ou o botão Atualizar: o "onde este commit está" pode ter mudado.
      repos.onDidChange(() => {
        this.repoVersion++;
        if (!this.panel || !this.hash) return;
        // Escondida, a tela nem existe (o VS Code a recria ao voltar e ela pede tudo de novo).
        if (this.ready && this.panel.visible) void this.load(this.hash);
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('visualGit.animations') || event.affectsConfiguration('workbench.reduceMotion')) {
          this.post({ type: 'settings', motion: getMotionMode() });
        }
      }),
    );
  }

  /** Mostra os detalhes de um commit, criando a aba se ela ainda não existir. */
  show(hash: string): void {
    if (!isCommitHash(hash)) return;
    this.hash = hash;

    if (!this.panel) {
      this.ready = false;
      const panel = vscode.window.createWebviewPanel(
        'visualGit.details',
        'Commit',
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
        { enableScripts: true, localResourceRoots: webviewRoots(this.extensionUri) },
      );
      this.panel = panel;
      panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg');
      panel.webview.html = renderWebviewHtml(panel.webview, this.extensionUri, 'details', getMotionMode(), 'Commit');
      const listeners = [
        panel.webview.onDidReceiveMessage((message: FromDetailsView) => this.onMessage(message)),
        // Escondida (atrás de outra aba), a tela é destruída; ao voltar ela é recriada e manda "ready" de novo.
        // Até lá não adianta mandar nada para ela.
        panel.onDidChangeViewState(() => {
          if (!panel.visible) this.ready = false;
        }),
      ];
      listeners.push(
        panel.onDidDispose(() => {
          for (const listener of listeners.splice(0)) listener.dispose();
          if (this.panel !== panel) return;
          this.panel = undefined;
          this.ready = false;
          // Um carregamento ainda a caminho era para esta aba: a próxima não pode recebê-lo.
          this.requestId++;
          this.hash = undefined;
          this.details = undefined;
          this.repo = undefined;
        }),
      );
    } else {
      this.panel.reveal(undefined, true);
    }

    if (this.ready) this.deliver(hash);
  }

  /** Manda o commit para a tela: da memória, se já foi lido e nada mudou; senão lê no Git. */
  private deliver(hash: string): void {
    if (this.details?.hash === hash && this.detailsVersion === this.repoVersion) {
      this.requestId++; // um carregamento de outro commit ainda a caminho não vale mais
      this.post({ type: 'details', details: this.details });
      return;
    }
    void this.load(hash);
  }

  private async onMessage(message: FromDetailsView): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.post({ type: 'settings', motion: getMotionMode() });
        if (this.hash) this.deliver(this.hash);
        break;
      case 'openCommit':
        if (isCommitHash(message.hash)) {
          this.show(message.hash);
          this.onNavigate(message.hash);
        }
        break;
      case 'openFile': {
        // A tela só manda a posição na lista; o caminho vem da nossa própria cópia dos detalhes.
        const file = Number.isInteger(message.index) ? this.details?.files[message.index] : undefined;
        if (file && this.details && this.repo) await openFileChange(this.repo, this.details, file);
        break;
      }
      case 'copyHash':
        if (this.details) {
          await vscode.env.clipboard.writeText(this.details.hash);
          void vscode.window.setStatusBarMessage('$(check) Hash do commit copiado', 2500);
        }
        break;
    }
  }

  private async load(hash: string): Promise<void> {
    const id = ++this.requestId;
    const version = this.repoVersion;
    this.post({ type: 'loading', hash });
    const result = await this.repos.get();
    if (id !== this.requestId) return;
    if ('state' in result) {
      this.post({ type: 'error', message: 'Não foi possível acessar o repositório.' });
      return;
    }
    try {
      const details = await readCommitDetails(result.repo, hash);
      if (id !== this.requestId) return; // o usuário já clicou em outro commit (ou fechou a aba)
      this.repo = result.repo;
      this.details = details;
      this.detailsVersion = version;
      if (this.panel) this.panel.title = `Commit ${details.hash.slice(0, 7)}`;
      this.post({ type: 'details', details });
    } catch (error) {
      if (id !== this.requestId) return;
      this.post({ type: 'error', message: this.repos.toErrorState(error).message });
    }
  }

  private post(message: ToDetailsView): void {
    void this.panel?.webview.postMessage(message);
  }

  dispose(): void {
    this.panel?.dispose();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }
}

/** Abre o "antes e depois" de um arquivo usando o editor de diferenças do próprio VS Code. */
async function openFileChange(repo: Repo, details: CommitDetails, file: FileChange): Promise<void> {
  const fileUri = safeFileUri(repo.root, file.path);
  const oldUri = safeFileUri(repo.root, file.oldPath ?? file.path);
  if (!fileUri || !oldUri) return;
  const short = details.hash.slice(0, 7);
  const name = file.path.split('/').pop() ?? file.path;

  // Submódulo não tem "antes e depois" de texto: só muda para qual commit do outro projeto ele aponta.
  const submodule = await submoduleNote(repo, details, file, name);
  if (submodule) {
    void vscode.window.showInformationMessage(submodule);
    return;
  }

  const git = await getBuiltInGitApi();
  if (!git) {
    void vscode.window.showWarningMessage('Para ver as diferenças, ative a extensão "Git" que já vem com o VS Code.');
    return;
  }
  // Os endereços "git:" só são lidos pela extensão nativa se ela tiver aberto este repositório
  // (ela pode não ter aberto: subpasta de um monorepo, detecção automática desligada...).
  const opened = git.getRepository(fileUri) ?? (await git.openRepository?.(vscode.Uri.file(repo.root)).catch(() => null));
  if (!opened) {
    void vscode.window.showWarningMessage(
      'Não foi possível mostrar o antes e depois: a extensão "Git" do VS Code não abriu este projeto. ' +
        'Abra a aba Controle do Código-Fonte, abra o repositório por lá e tente de novo.',
    );
    return;
  }

  const after = git.toGitUri(fileUri, details.hash);

  if (file.status === 'added' || !details.comparedTo) {
    await vscode.commands.executeCommand('vscode.open', after, { preview: true }, `${name} (adicionado em ${short})`);
    return;
  }
  const before = git.toGitUri(oldUri, details.comparedTo);
  if (file.status === 'deleted') {
    await vscode.commands.executeCommand('vscode.open', before, { preview: true }, `${name} (removido em ${short})`);
    return;
  }
  await vscode.commands.executeCommand('vscode.diff', before, after, `${name} (${short}) — antes ↔ depois`, { preview: true });
}

/** Se o arquivo é um submódulo (outro projeto Git dentro deste), a frase que explica o que mudou nele. */
async function submoduleNote(repo: Repo, details: CommitDetails, file: FileChange, name: string): Promise<string | undefined> {
  const read = (hash: string, path: string) => readTreeEntry(repo, hash, path).catch(() => null);
  const [after, before] = await Promise.all([
    file.status === 'deleted' ? null : read(details.hash, file.path),
    details.comparedTo && file.status !== 'added' ? read(details.comparedTo, file.oldPath ?? file.path) : null,
  ]);
  const now = after?.type === 'commit' ? after.hash.slice(0, 7) : null;
  const was = before?.type === 'commit' ? before.hash.slice(0, 7) : null;
  const what = `"${name}" é um submódulo (outro projeto Git guardado dentro deste).`;
  if (now && was) return `${what} Neste commit ele passou da versão ${was} para a versão ${now} daquele projeto.`;
  if (now) return `${what} Neste commit ele passou a fazer parte do projeto, na versão ${now}.`;
  if (was) return `${what} Neste commit ele foi removido (estava na versão ${was}).`;
  return undefined;
}

/** Monta o endereço do arquivo garantindo que ele fica dentro do repositório. */
function safeFileUri(root: string, path: string): vscode.Uri | undefined {
  const full = join(root, path);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return vscode.Uri.file(full);
}
