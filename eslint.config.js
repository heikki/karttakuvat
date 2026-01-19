import love from 'eslint-config-love';

export default [
  {
    ignores: ['**/dist/**']
  },
  {
    ...love,
    files: ['**/*.js', '**/*.ts', '**/*.tsx'],
    rules: {
      ...love.rules,
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/init-declarations': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      'complexity': 'off',
      'max-lines': 'off',
      'no-console': 'off',
      'no-plusplus': 'off',
      'radix': 'off'
    }
  }
];
