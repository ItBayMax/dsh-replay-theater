#!/usr/bin/env node
/**
 * Build the browser half into the single `lib/client.js` artifact dsh's client
 * module system loads.
 *
 * The format is not ours to choose: `ClientModuleRegistry` stats exactly
 * `<package>/lib/client.js` and expects a self-registering closure factory.
 * This script reproduces upstream's `clientBundle` tsdown preset
 * (packages/client/tsdown.client.ts) with esbuild:
 *
 *   window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => {
 *     var module = { exports: {} }; var exports = module.exports;
 *     …CJS bundle, externals resolved through the injected require…
 *     return module.exports; } });
 *
 * Externals are the shell's seed table (PLATFORM_MODULES) — anything else must
 * inline, because a `require()` the table cannot answer throws at boot.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { build } from 'esbuild'
import { transform } from 'lightningcss'

const PKG = 'dsh-replay-theater'

/**
 * The shell's static module table. Mirrors PLATFORM_MODULES at
 * deepseek-harness/packages/client/web/src/platform.ts:8 (dsh 0.1.2-alpha.2).
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Compile `*.module.css` to a hashed class map plus a style injector, the way
 * upstream's `dsh-css-modules-inline` plugin does.
 */
const cssModulesPlugin = {
  name: 'dsh-css-modules-inline',
  setup(builder) {
    builder.onLoad({ filter: /\.module\.css$/u }, async (args) => {
      const source = await readFile(args.path)
      const { code, exports: cssExports } = transform({
        filename: args.path,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap = {}
      for (const [local, exported] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
        classMap[local] = exported.name
      }
      const tagId = `${PKG}/${basename(args.path)}`
      const contents = [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(PKG)};`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
      return { contents, loader: 'js', resolveDir: dirname(args.path) }
    })
  },
}

const result = await build({
  entryPoints: [resolve('src/client/index.ts')],
  outfile: resolve('lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  external: PLATFORM_MODULES,
  jsx: 'automatic',
  sourcemap: true,
  sourcesContent: true,
  minify: false,
  // Node-idiom deps read process.env.NODE_ENV; a browser factory has no process.
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
  plugins: [cssModulesPlugin],
  logLevel: 'warning',
})

if (result.errors.length > 0) process.exit(1)

const artifact = await readFile('lib/client.js', 'utf8')
// esbuild emits `module.exports = ...` assignments; the factory returns that
// object, so nothing else is needed. Assert the wrapper survived minification.
if (!artifact.startsWith('window.__ModuleLoader__.load(')) {
  console.error('build-client: banner missing from lib/client.js')
  process.exit(1)
}
console.log(`lib/client.js  ${(artifact.length / 1024).toFixed(1)} kB`)
