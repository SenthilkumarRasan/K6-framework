// Prefer to import `@eslint/js` and `globals` when available. Use fallbacks
// so this config can be loaded even when devDependencies are not installed.
let pluginJs;
let globalsPkg;
try {
  pluginJs = await import('@eslint/js').then((m) => m.default || m);
} catch {
  // Fallback empty recommended config if @eslint/js is not available
  pluginJs = { configs: { recommended: {} } };
}

try {
  globalsPkg = await import('globals').then((m) => m.default || m);
} catch {
  globalsPkg = { browser: {}, node: {} };
}


/**
 * Flat config: first entry defines files to ignore, second entry holds rules.
 */
/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    languageOptions: {
      globals: {
        ...globalsPkg.browser,
        ...globalsPkg.node,
        __ENV: 'readonly',
        __VU: 'readonly'
      }
    }
  },
  {
    ignores: ['utils/bundle.js'], // 👈 Exclude this file
  },

  pluginJs.configs.recommended,
  {
    rules: {
      'indent': ['error', 2],
      'brace-style': ['error', '1tbs', { 'allowSingleLine': true }],
      'import/no-unresolved': 0,
      'import/extensions': 0,
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'no-unused-vars': ['error', { 
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_' 
      }]
    },
  }

];