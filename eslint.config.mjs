import globals from 'globals';
import pluginJs from '@eslint/js';


/** @type {import('eslint').Linter.Config[]} */
export default [
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  {
    rules: {
      'indent': ['error', 2],
      'brace-style': ['error', '1tbs', { 'allowSingleLine': true }],
      'import/no-unresolved': 0,
      'import/extensions': 0,
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
    },
  }

];