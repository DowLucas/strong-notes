import { useEffect } from 'react';
import { LogBox } from 'react-native';

// SecureStore can throw before the iOS keychain unlocks on cold launch.
// The i18n / session loaders already swallow the error and fall back to
// defaults. The yellow-box warning leaks the implementation detail into
// the UI for no actionable reason, so silence that specific pattern.
LogBox.ignoreLogs([/ExpoSecureStore/i]);

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppAlertHost } from '@/components/AppAlert/AppAlertHost';
import { AuthProvider, useAuth } from '@/lib/auth';
import '@/lib/i18n';

// Fast Refresh re-runs this module after the splash has already hidden, at
// which point hideAsync rejects with "No native splash screen registered…".
// The rejections are benign — the splash is gone — but noisy. Swallow them.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'SNPro-Regular': require('../assets/fonts/SNPro-Regular.ttf'),
    'SNPro-Medium': require('../assets/fonts/SNPro-Medium.ttf'),
    'SNPro-SemiBold': require('../assets/fonts/SNPro-SemiBold.ttf'),
    'JetBrainsMono': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrainsMono-Medium': require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SplashGate />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings/about" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings/dictionary" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="exercise/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
        <StatusBar style="dark" />
        <AppAlertHost />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Keeps the native splash up until the persisted session has been read, so
 * the first frame is the right screen (tabs or sign-in) rather than a flash
 * of one before the redirect to the other. Fonts are already loaded by the
 * time this mounts.
 */
function SplashGate() {
  const { loading } = useAuth();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);
  return null;
}
