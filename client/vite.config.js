import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Swasthya Setu',
        short_name: 'Swasthya Setu',
        description: 'Book doctors, keep your health records and get emergency help — even on a weak network.',
        theme_color: '#1565D8',
        background_color: '#F1F6FD',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Emergency', short_name: 'SOS', url: '/emergency', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }],
      },
      workbox: {
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        globPatterns: ['**/*.{js,css,html,png,svg,jpeg,woff2}'],
        runtimeCaching: [
          {
            // Photos load on first view (not at install, to keep 2G installs small), then work offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/img/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            // If an emergency alert cannot be sent, the service worker keeps it
            // and replays it when the connection returns — even if the app is
            // closed (Chrome/Android). The server ignores duplicates by clientRef.
            urlPattern: ({ url }) => url.pathname === '/api/emergency/alerts',
            method: 'POST',
            handler: 'NetworkOnly',
            options: { backgroundSync: { name: 'sos-queue', options: { maxRetentionTime: 24 * 60 } } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
