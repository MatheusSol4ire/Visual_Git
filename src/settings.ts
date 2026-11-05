import * as vscode from 'vscode';
import type { MotionMode } from './shared/protocol.ts';

/**
 * Decide se as animações ficam ligadas.
 *  - "on"/"off" na configuração do Visual Git mandam.
 *  - "auto" segue o `workbench.reduceMotion` do VS Code; se ele também for "auto",
 *    a tela segue o sistema operacional (prefers-reduced-motion).
 */
export function getMotionMode(): MotionMode {
  const own = vscode.workspace.getConfiguration('visualGit').get<MotionMode>('animations', 'auto');
  if (own === 'on' || own === 'off') return own;

  const reduceMotion = vscode.workspace.getConfiguration('workbench').get<string>('reduceMotion', 'auto');
  if (reduceMotion === 'on') return 'off';
  if (reduceMotion === 'off') return 'on';
  return 'auto';
}
