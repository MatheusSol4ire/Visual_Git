// Gera os pacotes:
//  - dist/extension.cjs           -> o "backend" que roda dentro do VS Code (Node)
//  - dist/commits.js + .css       -> a lista de commits da barra lateral
//  - dist/details.js + .css       -> a aba de detalhes do commit
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do projeto = a pasta deste arquivo, seja qual for a pasta do terminal. Assim o `rmSync`
// abaixo nunca apaga a pasta `dist` de outro lugar, e as entradas/saídas sempre são as do projeto.
const root = fileURLToPath(new URL('.', import.meta.url));

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Começa sempre do zero, para não sobrar arquivo velho dentro do .vsix.
rmSync(join(root, 'dist'), { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
  absWorkingDir: root,
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: {
      commits: 'webview/commits/main.tsx',
      details: 'webview/details/main.tsx',
    },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
