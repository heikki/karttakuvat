/** @type {import("prettier").Config} */
const config = {
  quoteProps: 'consistent',
  semi: true,
  singleQuote: true,
  trailingComma: 'none',
  plugins: ['@trivago/prettier-plugin-sort-imports'],
  importOrder: [
    '^react(-dom.*)?$',
    '<THIRD_PARTY_MODULES>',
    '^@repo/.*$',
    '^[./]'
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true
};

export default config;
