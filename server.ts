import { serve } from 'bun';

import indexHtml from './src/index.html';

const server = serve({
  routes: {
    '/': indexHtml
  },
  development: true,
  fetch(req) {
    const url = new URL(req.url);

    // Check public directory first
    let file = Bun.file(`public${url.pathname}`);
    if (file.size > 0) return new Response(file);

    // Check src directory (for CSS, etc.)
    file = Bun.file(`src${url.pathname}`);
    if (file.size > 0) return new Response(file);

    return new Response('Not Found', { status: 404 });
  }
});

console.log(`🚀 Server running on ${server.url.toString()}`);
