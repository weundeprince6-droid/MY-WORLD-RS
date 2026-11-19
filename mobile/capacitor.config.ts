import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cd.weunde.webservicesacademy',
  appName: 'WEBSERVICES ACADEMY',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https'
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com']
    }
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
