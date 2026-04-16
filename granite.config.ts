import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'reflex-test',
  brand: {
    displayName: '반응속도',
    primaryColor: '#00D2D3',
    icon: '',
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
