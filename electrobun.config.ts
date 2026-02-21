import type { ElectrobunConfig } from 'electrobun';
import { existsSync } from 'fs';
import { resolve } from 'path';

const baseDir = resolve('.');

function resolveWithExtensions(basePath: string): string {
  for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return basePath;
}

// Inline plugin to resolve @common/* and @components/* path aliases
const pathAliasPlugin = {
  name: 'tsconfig-paths',
  setup(build: { onResolve: Function }) {
    build.onResolve(
      { filter: /^@common\// },
      (args: { path: string }) => ({
        path: resolveWithExtensions(
          resolve(baseDir, 'src/common', args.path.replace('@common/', ''))
        )
      })
    );

    build.onResolve(
      { filter: /^@components\// },
      (args: { path: string }) => ({
        path: resolveWithExtensions(
          resolve(
            baseDir,
            'src/components',
            args.path.replace('@components/', '')
          )
        )
      })
    );
  }
};

export default {
  app: {
    name: 'Karttakuvat',
    identifier: 'com.karttakuvat.app',
    version: '1.0.0'
  },

  runtime: {
    exitOnLastWindowClosed: true
  },

  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
      external: ['prettier'],
      plugins: [pathAliasPlugin]
    },

    views: {
      app: {
        entrypoint: 'src/index.ts',
        plugins: [pathAliasPlugin],
        define: {
          'process.env.PUBLIC_MML_API_KEY': JSON.stringify(
            process.env.PUBLIC_MML_API_KEY ?? ''
          ),
          'process.env.PUBLIC_THUNDERFOREST_API_KEY': JSON.stringify(
            process.env.PUBLIC_THUNDERFOREST_API_KEY ?? ''
          )
        }
      }
    },

    copy: {
      'src/index.html': 'views/app/index.html',
      'src/styles.css': 'views/app/styles.css',
      'node_modules/maplibre-gl/dist/maplibre-gl.css':
        'views/app/maplibre-gl.css'
    },

    mac: {
      icons: 'icon.iconset',
      defaultRenderer: 'native'
    }
  }
} satisfies ElectrobunConfig;
