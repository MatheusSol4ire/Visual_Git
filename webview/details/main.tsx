import { render } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import type { CommitDetails, CommitPlacement, FileChange, FileStatus, FromDetailsView, ToDetailsView } from '../../src/shared/protocol.ts';
import { Avatar, RefChips } from '../shared/components.tsx';
import { formatCount, fullDate, isolate, plural, shortHash, showControls, timeAgo } from '../shared/format.ts';
import { parseSavedDetails } from '../shared/savedState.ts';
import { useNow } from '../shared/clock.ts';
import { isToDetailsView } from '../shared/messages.ts';
import { applyMotion, getVsCode, onHostMessage } from '../shared/vscode.ts';
import '../styles/base.css';
import '../styles/details.css';

const vscode = getVsCode<FromDetailsView>();

// Escondida atrás de outra aba (ex.: o "antes e depois" de um arquivo), esta tela é destruída e
// recriada ao voltar. Guardamos qual commit estava aberto e a rolagem, para voltar ao mesmo lugar.
const saved = parseSavedDetails(vscode.getState());
/** Commit cuja rolagem salva ainda não foi restaurada (vale uma vez só). */
let pendingRestore = saved.hash;
let shownHash: string | null = null;
/**
 * A pessoa foi para outro commit pelos botões desta aba ("Commit anterior"): o botão some com a troca,
 * então o foco vai para o título do commit novo (o leitor de tela lê o assunto e o Tab segue dali).
 */
let focusNext = false;
/** Ref de elemento que recebe o foco depois de uma navegação pela aba. */
const takeFocus = (element: HTMLElement | null) => {
  if (!element || !focusNext) return;
  focusNext = false;
  element.focus();
};
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

const scroller = () => document.scrollingElement ?? document.documentElement;
const rememberScroll = () => {
  if (shownHash) vscode.setState({ hash: shownHash, scrollTop: Math.round(scroller().scrollTop) });
};
window.addEventListener(
  'scroll',
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(rememberScroll, 150);
  },
  true,
);

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  /** `restored`: o mesmo commit que estava aberto antes de a tela ser recriada. */
  | { kind: 'details'; details: CommitDetails; restored: boolean };

function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const onMessage = (message: ToDetailsView) => {
      switch (message.type) {
        case 'settings':
          applyMotion(message.motion);
          break;
        case 'loading':
          setView((current) => (current.kind === 'details' && current.details.hash === message.hash ? current : { kind: 'loading' }));
          break;
        case 'details': {
          const restored = pendingRestore === message.details.hash;
          pendingRestore = null;
          setView((current) =>
            // Recarga do mesmo commit (o repositório mudou): mantém o "voltou sem animação" se já era.
            current.kind === 'details' && current.details.hash === message.details.hash
              ? { ...current, details: message.details }
              : { kind: 'details', details: message.details, restored },
          );
          break;
        }
        case 'error':
          setView({ kind: 'error', message: message.message });
          break;
      }
    };
    const stop = onHostMessage(isToDetailsView, onMessage);
    vscode.postMessage({ type: 'ready' });
    return stop;
  }, []);

  if (view.kind === 'loading') return <Skeleton />;
  if (view.kind === 'error') {
    return (
      <div class="empty error">
        <span class="empty-title">Não foi possível abrir este commit</span>
        <span>{view.message}</span>
        <button
          type="button"
          ref={takeFocus}
          onClick={() => {
            setView({ kind: 'loading' });
            // O "ready" faz a extensão mandar de novo o commit desta aba (lendo do Git se preciso).
            vscode.postMessage({ type: 'ready' });
          }}
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  // A key faz a animação de entrada rodar de novo a cada commit aberto.
  return <Details key={view.details.hash} details={view.details} restored={view.restored} />;
}

function Details({ details, restored }: { details: CommitDetails; restored: boolean }) {
  const now = useNow();
  const sameCommitter = details.committerName === details.authorName;
  const isMerge = details.parents.length > 1;

  useLayoutEffect(() => {
    shownHash = details.hash;
    if (restored && saved.scrollTop > 0) scroller().scrollTop = saved.scrollTop;
    rememberScroll();
  }, []);

  return (
    <main class="page" style={restored ? { animation: 'none' } : undefined}>
      <header class="hero">
        <h1 class="title" tabIndex={-1} ref={takeFocus}>
          {details.subject || <span class="muted">(sem mensagem)</span>}
        </h1>
        <RefChips refs={details.refs} />
      </header>

      <section class="meta">
        <Avatar name={details.authorName} email={details.authorEmail} size="lg" />
        <div class="meta-text">
          <div>
            <strong>
              <bdi>{showControls(details.authorName)}</bdi>
            </strong>{' '}
            <span class="muted">fez este commit {timeAgo(details.date, now)}</span>
          </div>
          <div class="muted small">
            {fullDate(details.date)}
            {!sameCommitter && (
              <>
                {' · aplicado por '}
                <bdi>{showControls(details.committerName)}</bdi>
              </>
            )}
          </div>
        </div>
        <CopyHashButton hash={details.hash} />
      </section>

      {details.placement && <Placement placement={details.placement} />}

      {details.body && <pre class="body">{details.body}</pre>}

      <section class="lineage">
        {details.parents.length === 0 && <span class="muted">Este é o primeiro commit do projeto.</span>}
        {/* No merge, um rótulo por pai: o 1º é o commit anterior na branch onde o merge foi feito; os outros vieram de outra branch. */}
        {details.parents.map((parent, index) => (
          <div key={parent} class="lineage-row">
            <span class="muted">
              {!isMerge ? 'Commit anterior:' : index === 0 ? 'Commit anterior nesta branch:' : 'Trazido de outra branch:'}
            </span>
            <button
              type="button"
              class="ghost parent mono"
              title="Abrir este commit"
              onClick={() => {
                focusNext = true;
                vscode.postMessage({ type: 'openCommit', hash: parent });
              }}
            >
              {shortHash(parent)}
            </button>
          </div>
        ))}
      </section>

      {isMerge && (
        <p class="note">
          Este commit é uma <strong>junção (merge)</strong>: ele traz o trabalho de outra branch para esta. A lista abaixo
          mostra o que mudou nesta branch com o merge (comparando com {shortHash(details.comparedTo ?? '')}).
        </p>
      )}

      <FileList details={details} restored={restored} />
    </main>
  );
}

/** Se o commit já entrou na branch principal e em quais branches ele aparece. */
function Placement({ placement }: { placement: CommitPlacement }) {
  const { baseName, inBase, branches, totalBranches } = placement;
  return (
    <section class="placement">
      {baseName && (
        <div class={inBase ? 'place-status place-in' : 'place-status place-out'}>
          {inBase ? <CheckIcon /> : <PendingIcon />}
          {inBase ? (
            <span>
              Este commit já está na{' '}
              <strong>
                <bdi>{showControls(baseName)}</bdi>
              </strong>
              .
            </span>
          ) : (
            <span>
              Este commit <strong>ainda não está</strong> na{' '}
              <strong>
                <bdi>{showControls(baseName)}</bdi>
              </strong>
              .
            </span>
          )}
        </div>
      )}
      <div class="place-branches">
        {branches.length === 0 ? (
          <span class="muted">Ele não está em nenhuma branch.</span>
        ) : (
          <>
            <span class="muted">Aparece em:</span>
            <RefChips refs={branches} />
            {totalBranches > branches.length && (
              <span class="muted small">e mais {plural(totalBranches - branches.length, 'branch', 'branches')}</span>
            )}
          </>
        )}
      </div>
    </section>
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

function FileList({ details, restored }: { details: CommitDetails; restored: boolean }) {
  const { files, totalFiles } = details;
  const counted = !details.uncounted;
  // Somados pela extensão em todos os arquivos do commit (a lista pode vir cortada em 500).
  const additions = details.totalAdditions;
  const deletions = details.totalDeletions;

  return (
    <section class="files">
      <div class="files-header">
        <h2>Arquivos alterados</h2>
        <span class="muted">
          {/* Números com separador de milhar ("1.834 arquivos · +45.210 −95"), como em `plural`. */}
          {plural(totalFiles, 'arquivo', 'arquivos')}
          {counted && (
            <>
              {' · '}
              <span class="plus">+{formatCount(additions)}</span> <span class="minus">−{formatCount(deletions)}</span>
            </>
          )}
        </span>
      </div>

      {files.length === 0 ? (
        <p class="muted">Nenhum arquivo foi alterado neste commit.</p>
      ) : (
        <>
          <p class="hint muted small">Clique num arquivo para ver o antes e depois.</p>
          {!counted && <p class="hint muted small">As linhas adicionadas e removidas não foram contadas neste commit.</p>}
          <ul class="file-list">
            {files.map((file, index) => (
              <FileRow key={file.path} file={file} index={index} restored={restored} counted={counted} />
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

function FileRow({ file, index, restored, counted }: { file: FileChange; index: number; restored: boolean; counted: boolean }) {
  const status = STATUS[file.status];
  // Caminhos vêm do repositório: caracteres de direção ficam visíveis, e cada parte vai num <bdi>.
  const path = showControls(file.path);
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? '' : path.slice(0, slash + 1);

  return (
    <li class="file" style={restored ? { animation: 'none' } : { animationDelay: `${Math.min(index, 20) * 18}ms` }}>
      <button type="button" class="file-button" onClick={() => vscode.postMessage({ type: 'openFile', index })} title={`${status.label}: ${isolate(file.path)}`}>
        <span class={`status status-${file.status}`} aria-label={status.label}>
          {status.letter}
        </span>
        {/* Numa aba estreita o "…" corta primeiro o caminho antigo, depois a pasta; o nome do arquivo fica. */}
        <span class="file-path">
          {file.oldPath && (
            <>
              <bdi class="file-old muted">{showControls(file.oldPath)}</bdi>
              <span class="file-arrow muted">→</span>
            </>
          )}
          {dir && <bdi class="file-dir muted">{dir}</bdi>}
          <bdi class="file-name">{name}</bdi>
        </span>
        {counted && <ChangeCount file={file} />}
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
      <span class="plus">+{formatCount(file.additions)}</span> <span class="minus">−{formatCount(file.deletions)}</span>
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
    <main class="page" aria-busy="true">
      <span class="sr-only" role="status">
        Carregando commit…
      </span>
      <span class="skeleton" style={{ display: 'block', width: '60%', height: '20px', marginBottom: '20px' }} />
      <span class="skeleton" style={{ display: 'block', width: '35%', height: '12px', marginBottom: '32px' }} />
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} class="skeleton" style={{ display: 'block', width: `${90 - i * 10}%`, height: '12px', marginBottom: '12px' }} />
      ))}
    </main>
  );
}

function CheckIcon() {
  return (
    <svg class="place-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M5.3 8.2l1.9 1.9 3.6-3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg class="place-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.4 2" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Botão que copia o código do commit. A extensão confirma na barra de status, longe do botão; por isso
 * o próprio botão mostra ✓ e "Copiado!" por 2 s e o leitor de tela ouve a mesma frase da barra.
 */
function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <button
        type="button"
        class="hash"
        title="Copiar o código completo deste commit"
        onClick={() => {
          vscode.postMessage({ type: 'copyHash' });
          // Um número novo a cada clique: clicar de novo dentro dos 2 s recomeça a contagem.
          setCopied((count) => count + 1);
        }}
      >
        {/* Por 2 s: "Copiado!" no lugar do código e o ✓ no lugar do ícone de copiar. */}
        {copied ? <span>Copiado!</span> : <span class="mono">{shortHash(hash)}</span>}
        {copied ? <CopiedIcon /> : <CopyIcon />}
      </button>
      {/* Fica sempre na página (vazia): o leitor de tela só anuncia o que muda dentro de uma região que já existe. */}
      <span class="sr-only" role="status">
        {copied ? 'Código do commit copiado' : ''}
      </span>
    </>
  );
}

function CopiedIcon() {
  return (
    <svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
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
