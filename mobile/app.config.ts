import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Strong Notes',
  slug: 'strong-notes',
  version: '1.0.0',
  scheme: 'strongnotes',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    // The UI uses a centered max-width content column (see lib/responsive.ts +
    // components/ContentContainer.tsx) so it reads as a single column on iPad
    // instead of stretching edge to edge.
    supportsTablet: true,
    bundleIdentifier: 'com.dowlucas.strongnotes',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription:
        'Allow Scaffold to access your photo library to upload a profile picture.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F0E5CC',
    },
    package: 'com.dowlucas.strongnotes',
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F0E5CC',
        imageWidth: 200,
        resizeMode: 'contain',
      },
    ],
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/SNPro-VariableFont_wght.ttf',
          './assets/fonts/SNPro-Italic-VariableFont_wght.ttf',
          './assets/fonts/JetBrainsMono-Regular.ttf',
          './assets/fonts/JetBrainsMono-Medium.ttf',
        ],
      },
    ],
    [
      'expo-secure-store',
      {
        faceIDPermission: 'Allow Scaffold to access Face ID.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Scaffold to access your photo library to upload a profile picture.',
      },
    ],
    'expo-localization',
    'expo-sqlite',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    // Single backend base URL. Defaults to localhost for dev; override per
    // build with EXPO_PUBLIC_API_URL.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080',
  },
};

export default config;
