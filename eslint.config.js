import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'projects/', 'test/fixtures/', 'test-results/', 'playwright-report/', 'coverage/', '.workflow/', 'design/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    ...reactHooks.configs.flat.recommended,
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
