import type { ExpoConfig } from 'expo/config';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';
// Plain-HTTP dev backend (localhost or a Tailscale/LAN IP): both iOS ATS and
// Android 9+ block cleartext traffic by default, so exempt it here. A
// production build points EXPO_PUBLIC_API_URL at an https:// URL, which
// leaves this false and both platforms' default secure policy untouched.
const isDevHttpBackend = apiBaseUrl.startsWith('http://');

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
    // Sign in with Apple entitlement (native button on the sign-in screen).
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription:
        'Allow Strong Notes to access your photo library to upload a profile picture.',
      ...(isDevHttpBackend ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {}),
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#F0E5CC',
    },
    package: 'com.dowlucas.strongnotes',
    ...(isDevHttpBackend ? { usesCleartextTraffic: true } : {}),
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
        faceIDPermission: 'Allow Strong Notes to access Face ID.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Strong Notes to access your photo library to upload a profile picture.',
      },
    ],
    'expo-localization',
    'expo-sqlite',
    'expo-apple-authentication',
  ],
  experiments: {
    typedRoutes: true,
  },
  owner: 'lucasdow1',
  extra: {
    apiBaseUrl,
    eas: {
      projectId: '86cfc963-b04d-4dd7-9f9a-d7d0f89a1d13',
    },
  },
};

export default config;
