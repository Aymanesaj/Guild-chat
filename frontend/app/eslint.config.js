import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Shared styled-components primitives: these modules intentionally export
    // several styled helpers alongside a component, which is not a fast-refresh
    // boundary the way a route/page module is.
    files: ['src/components/ui/**/*.{js,jsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
