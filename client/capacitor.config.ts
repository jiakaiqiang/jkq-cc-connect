import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jkq.ccconnect',
  appName: 'CC Connect',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
};

export default config;
