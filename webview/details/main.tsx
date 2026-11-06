import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { CommitDetails, FileChange, FileStatus, FromDetailsView, ToDetailsView } from '../../src/shared/protocol.ts';
import { Avatar, RefChips } from '../shared/components.tsx';
import { fullDate, plural, shortHash, timeAgo } from '../shared/format.ts';
import { applyMotion, getVsCode } from '../shared/vscode.ts';
import '../styles/base.css';
import '../styles/details.css';

const vscode = getVsCode<FromDetailsView>();

type View = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'details'; details: CommitDetails };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToDetailsView>) => {
      const message = event.data;
      switch (message.type) {
        case 'settings':
          applyMotion(message.motion);
          break;
        case 'loading':
          setView((current) => (current.kind === 'details' && current.details.hash === message.hash ? current : { kind: 'loading' }));
          break;
        case 'details':
          setView({ kind: 'details', details: message.details });
          break;
        case 'error':
          setView({ kind: 'error', message: message.message });
          break;
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (view.kind === 'loading') return <Skeleton />;
  if (view.kind === 'error') {
    return (
      <div class="empty error">
        <span class="empty-title">Não foi possível abrir este commit</span>
        <span>{view.message}</span>
      </div>
    );
  }
  // A key faz a animação de entrada rodar de novo a cada commit aberto.
  return <Details key={view.details.hash} details={view.details} />;
}

function Details({ details }: { details: CommitDetails }) {
  const sameCommitter = details.committerName === details.authorName;
  const isMerge = details.parents.length > 1;

  return (
    <main class="page">
      <header class="hero">
        <h1 class="title">{details.subject || <span class="muted">(sem mensagem)</span>}</h1>
        <RefChips refs={details.refs} />
      </header>

      <section class="meta">
        <Avatar name={details.authorName} email={details.authorEmail} size="lg" />
        <div class="meta-text">
          <div>
            <strong>{details.authorName}</strong> <span class="muted">fez este commit {timeAgo(details.date)}</span>
          </div>
          <div class="muted small">
            {fullDate(details.date)}
            {!sameCommitter && ` · aplicado por ${details.committerName}`}
          </div>
        </div>
        <button type="button" class="hash" title="Copiar o código completo deste commit" onClick={() => vscode.postMessage({ type: 'copyHash' })}>
          <span class="mono">{shortHash(details.hash)}</span>
          <CopyIcon />
        </button>
      </section>

      {details.body && <pre class="body">{details.body}</pre>}

      <section class="lineage">
        {details.parents.length === 0 && <span class="muted">Este é o primeiro commit do projeto.</span>}
        {details.parents.length > 0 && (
          <span class="muted">{isMerge ? 'Junta os commits:' : 'Commit anterior:'}</span>
        )}
        {details.parents.map((parent) => (
          <button
            key={parent}
            type="button"
            class="ghost parent mono"
            title="Abrir este commit"
            onClick={() => vscode.postMessage({ type: 'openCommit', hash: parent })}
          >
            {shortHash(parent)}
          </button>
        ))}
      </section>

      {isMerge && (
        <p class="note">
          Este commit é uma <strong>junção (merge)</strong>: ele une duas linhas de trabalho. As mudanças abaixo
          comparam com o primeiro commit anterior ({shortHash(details.comparedTo ?? '')}).
        </p>
      )}

      <FileList details={details} />
    </main>
  );
}

const STATUS: Record<FileStatus, { letter: string; label: string }> = {
  added: { letter: 'A', label: 'Adicionado' },
  modified: { letter: 'M', label: 'Modificado' },
  deleted: { letter: 'D', label: 'Removido' },
  renamed: { letter: 'R', label: 'Renomeado' },
  copied: { letter: 'C', label: 'Copiado' },
  typeChanged: { letter: 'T', label: 'Tipo alterado' },
  other: { letter: '?', label: 'Outra mudança' },
};

function FileList({ details }: { details: CommitDetails }) {
  const { files, totalFiles } = details;
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

  return (
    <section class="files">
      <div class="files-header">
        <h2>Arquivos alterados</h2>
        <span class="muted">
          {plural(totalFiles, 'arquivo', 'arquivos')} · <span class="plus">+{additions}</span>{' '}
          <span class="minus">−{deletions}</span>
        </span>
      </div>

      {files.length === 0 ? (
        <p class="muted">Nenhum arquivo foi alterado neste commit.</p>
      ) : (
        <>
          <p class="hint muted small">Clique num arquivo para ver o antes e depois.</p>
          <ul class="file-list">
            {files.map((file, index) => (
              <FileRow key={file.path} file={file} index={index} />
            ))}
          </ul>
        </>
      )}

      {totalFiles > files.length && (
        <p class="muted small">E mais {plural(totalFiles - files.length, 'arquivo', 'arquivos')} que não cabem aqui.</p>
      )}
    </section>
  );
}

function FileRow({ file, index }: { file: FileChange; index: number }) {
  const status = STATUS[file.status];
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const dir = slash === -1 ? '' : file.path.slice(0, slash + 1);

  return (
    <li class="file" style={{ animationDelay: `${Math.min(index, 20) * 18}ms` }}>
      <button type="button" class="file-button" onClick={() => vscode.postMessage({ type: 'openFile', index })} title={`${status.label}: ${file.path}`}>
        <span class={`status status-${file.status}`} aria-label={status.label}>
          {status.letter}
        </span>
        <span class="file-path">
          {file.oldPath && <span class="muted">{file.oldPath} → </span>}
          {dir && <span class="muted">{dir}</span>}
          <span class="file-name">{name}</span>
        </span>
        <ChangeCount file={file} />
      </button>
    </li>
  );
}

/** "+10 −2" e uma barrinha com a proporção, como no GitHub. Arquivos binários mostram "binário". */
function ChangeCount({ file }: { file: FileChange }) {
  if (file.additions === null || file.deletions === null) return <span class="count muted small">binário</span>;
  const total = file.additions + file.deletions;
  const blocks = 5;
  const green = total === 0 ? 0 : Math.round((file.additions / total) * blocks);
  return (
    <span class="count small">
      <span class="plus">+{file.additions}</span> <span class="minus">−{file.deletions}</span>
      <span class="bar" aria-hidden="true">
        {Array.from({ length: blocks }, (_, i) => (
          <span key={i} class={total === 0 ? 'bar-empty' : i < green ? 'bar-plus' : 'bar-minus'} />
        ))}
      </span>
    </span>
  );
}

function Skeleton() {
  return (
    <main class="page" aria-busy="true" aria-label="Carregando commit">
      <span class="skeleton" style={{ display: 'block', width: '60%', height: '20px', marginBottom: '20px' }} />
      <span class="skeleton" style={{ display: 'block', width: '35%', height: '12px', marginBottom: '32px' }} />
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} class="skeleton" style={{ display: 'block', width: `${90 - i * 10}%`, height: '12px', marginBottom: '12px' }} />
      ))}
    </main>
  );
}

function CopyIcon() {
  return (
    <svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M3 10.5V3.8C3 3.36 3.36 3 3.8 3h6.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
