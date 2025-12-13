import baseConfig from '../../eslint.config.mjs';
import jsoncParser from 'jsonc-eslint-parser';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredDependencies: [
            'jsonc-eslint-parser',
            'happy-dom',
            'tsdown',
            '@nx/dependency-checks',
          ],
        },
      ],
    },
    languageOptions: {
      parser: jsoncParser,
    },
  },
  {
    ignores: ['**/out-tsc'],
  },
];
