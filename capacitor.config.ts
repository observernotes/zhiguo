import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aicreaverse.zhiguo',
  appName: '智果',
  webDir: 'dist',
  server: {
    url: 'https://ai.aicreaverse.com',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#FFF7ED',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#FFF7ED',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#FFF7ED',
      style: 'DARK',
    },
  },
};

export default config;
