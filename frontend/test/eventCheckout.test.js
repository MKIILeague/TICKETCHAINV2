import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('opening an event renders its loading state before Firestore has returned', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [react()],
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { default: EventCheckout } = await server.ssrLoadModule('/src/EventCheckout.jsx');
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/event/example'] },
      createElement(Routes, null, createElement(Route, {
        path: '/event/:eventId', element: createElement(EventCheckout),
      }))));
    assert.match(html, /Loading event/);
    assert.doesNotMatch(html, /Confirm purchase/);
  } finally {
    await server.close();
  }
});
