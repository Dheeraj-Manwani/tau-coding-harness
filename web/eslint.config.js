import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // The public surfaces are the first thing a stranger downloads, so their
    // JS budget is fixed (§10 of doc/LANDING_AND_DOCS_PLAN.md: <160KB gzipped
    // for the landing page). Each package below is heavy enough to blow that
    // budget on its own, and each has a cheap in-house equivalent that
    // marketing and docs are meant to use instead. Enforced here because a
    // single stray import is invisible until someone reads a bundle report.
    files: ['src/features/marketing/**/*.{ts,tsx}', 'src/features/docs/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/star-particles', '@tsparticles/*'],
              message:
                'tsparticles is ~90-120KB gzipped. Public pages use CosmosBackdrop (features/marketing/motion) instead.',
            },
            {
              group: ['@uiw/react-codemirror', '@codemirror/*'],
              message:
                'CodeMirror belongs to the builder. Render code on public pages as static markup (docs CodeBlock, Phase 4).',
            },
            {
              group: ['ogl'],
              message: 'WebGL is out of budget on public pages. Use canvas 2D.',
            },
          ],
        },
      ],
    },
  },
])
