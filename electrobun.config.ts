import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ElectrobunConfig } from 'electrobun';

const baseDir = resolve('.');

// Aliases never include extensions, so we always append one. Listing
// '/index.ts' as a candidate (rather than relying on directory fall-through)
// matters because existsSync returns true for directories, which would
// otherwise short-circuit to a path Bun then can't read.
function resolveWithExtensions(basePath: string): string {
  for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  return basePath;
}

// Inline plugin to resolve @common/* and @components/* path aliases
const pathAliasPlugin = {
  name: 'tsconfig-paths',
  setup(build: {
    onResolve: (
      opts: { filter: RegExp },
      cb: (args: { path: string }) => { path: string }
    ) => void;
  }) {
    build.onResolve({ filter: /^@common\// }, (args: { path: string }) => ({
      path: resolveWithExtensions(
        resolve(baseDir, 'src/client/common', args.path.replace('@common/', ''))
      )
    }));

    build.onResolve({ filter: /^@components\// }, (args: { path: string }) => ({
      path: resolveWithExtensions(
        resolve(
          baseDir,
          'src/client/components',
          args.path.replace('@components/', '')
        )
      )
    }));
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
      entrypoint: 'src/app/index.ts',
      external: ['prettier'],
      plugins: [pathAliasPlugin],
      define: {
        'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
          process.env.PUBLIC_ORS_API_KEY ?? ''
        )
      }
    },

    views: {
      app: {
        entrypoint: 'src/client/index.ts',
        plugins: [pathAliasPlugin],
        define: {
          'process.env.PUBLIC_MML_API_KEY': JSON.stringify(
            process.env.PUBLIC_MML_API_KEY ?? ''
          ),
          'process.env.PUBLIC_ORS_API_KEY': JSON.stringify(
            process.env.PUBLIC_ORS_API_KEY ?? ''
          )
        }
      }
    },

    copy: {
      'src/client/index.html': 'views/app/index.html',
      'src/client/styles.css': 'views/app/styles.css',
      'node_modules/maplibre-gl/dist/maplibre-gl.css':
        'views/app/maplibre-gl.css',
      'build/scripts/sync.js': 'scripts/sync.js',
      'resources/native/libkarttakuvat.dylib': 'libkarttakuvat.dylib'
    },

    mac: {
      icons: 'resources/icon.iconset',
      defaultRenderer: 'native',
      createDmg: false
    }
  }
} satisfies ElectrobunConfig;
