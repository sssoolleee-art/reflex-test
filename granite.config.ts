import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'reflex-test',
  brand: {
    displayName: '반응속도',
    primaryColor: '#00D2D3',
    icon: 'https://static.toss.im/appsintoss/27863/8e4a2b8b-93af-4982-9a04-b3a15b8a4de3.png',
  },
  web: {
    host: 'localhost',
    port: 5179,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  permissions: [],
});
