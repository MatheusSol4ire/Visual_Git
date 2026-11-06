// Gera os pacotes:
//  - dist/extension.cjs           -> o "backend" que roda dentro do VS Code (Node)
//  - dist/commits.js + .css       -> a lista de commits da barra lateral
//  - dist/details.js + .css       -> a aba de detalhes do commit
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Começa sempre do zero, para não sobrar arquivo velho dentro do .vsix.
rmSync('dist', { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
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
