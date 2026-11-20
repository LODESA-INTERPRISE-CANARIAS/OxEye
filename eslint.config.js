import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

/**
 * Configuración de ESLint alineada con la Guía de Estilo de TypeScript de Google (GTS):
 * - Comillas simples con escape evitado
 * - Punto y coma obligatorio
 * - Prohibición de `var` y preferencia por `const`
 * - Sin espacios dentro de corchetes/llaves de importación (`{a, b}`)
 * - Igualdad estricta (`===` / `!==`, permitiendo `!= null`)
 * - Nomenclatura camelCase / PascalCase / UPPER_CASE
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'docs/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'src/data/json/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Reglas clave de la Guía de Estilo de Google TypeScript (GTS)
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      curly: ['error', 'multi-line'],
      quotes: ['error', 'single', {avoidEscape: true}],
      semi: ['error', 'always'],
      'block-scoped-var': 'error',
      'no-throw-literal': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/no-namespace': 'error',
    },
  },
);
