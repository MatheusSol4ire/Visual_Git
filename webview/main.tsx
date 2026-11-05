import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Commit, RepoState, ToWebview } from '../src/shared/protocol.ts';
import { shortHash, timeAgo } from './format.ts';
import { vscode } from './vscode.ts';
import './styles.css';

// ATENÇÃO: tela provisória. Serve só para confirmar que os dados do Git chegam até aqui.
// O layout e o design definitivos serão decididos antes de serem construídos.

type View =
  | { kind: 'loading' }
  | { kind: 'state'; state: RepoState }
  | { kind: 'commits'; repoName: string; commits: Commit[]; hasMore: boolean };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const message = event.data;
      switch (message.type) {
        case 'settings':
          document.body.dataset.motion = message.motion;
          break;
        case 'state':
          setView({ kind: 'state', state: message.state });
          break;
        case 'commits':
          setView((previous) => {
            const before = message.skip > 0 && previous.kind === 'commits' ? previous.commits.slice(0, message.skip) : [];
            return {
              kind: 'commits',
              repoName: message.repoName,
              commits: [...before, ...message.commits],
              hasMore: message.hasMore,
            };
          });
          break;
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (view.kind === 'loading') return <p class="notice">Carregando…</p>;
  if (view.kind === 'state') return <StateNotice state={view.state} />;

  return (
    <main>
      <header class="header">
        <h1>{view.repoName}</h1>
        <span class="muted">{view.commits.length} commits carregados</span>
        <button type="button" onClick={() => vscode.postMessage({ type: 'refresh' })}>
          Atualizar
        </button>
      </header>
      <ul class="commit-list">
        {view.commits.map((commit) => (
          <li key={commit.hash} class="commit">
            <code class="muted">{shortHash(commit.hash)}</code>
            <span class="subject">{commit.subject}</span>
            {commit.refs.map((ref) => (
              <span key={ref.type + ref.name} class={`ref ref-${ref.type}`}>
                {ref.name}
              </span>
            ))}
            <span class="muted">
              {commit.authorName} · {timeAgo(commit.date)}
            </span>
          </li>
        ))}
      </ul>
      {view.hasMore && (
        <button type="button" onClick={() => vscode.postMessage({ type: 'loadMore', skip: view.commits.length })}>
          Carregar mais
        </button>
      )}
    </main>
  );
}

function StateNotice({ state }: { state: RepoState }) {
  switch (state.kind) {
    case 'noWorkspace':
      return <p class="notice">Abra uma pasta de projeto no VS Code para ver os commits.</p>;
    case 'notRepo':
      return <p class="notice">Esta pasta ainda não usa Git.</p>;
    case 'gitMissing':
      return <p class="notice">O Git não foi encontrado neste computador.</p>;
    case 'empty':
      return <p class="notice">O projeto {state.repoName} ainda não tem nenhum commit.</p>;
    case 'error':
      return <p class="notice error">Algo deu errado: {state.message}</p>;
  }
}

const root = document.getElementById('root');
if (root) render(<App />, root);
