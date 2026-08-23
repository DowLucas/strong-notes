import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { colors, fontMono } from '@/lib/theme';
import { useAutoSync } from '@/src/sync/useAutoSync';

export default function TabsLayout() {
  const { session, loading, signedOutReason } = useAuth();
  const { t } = useTranslation();
  // Push unsynced sessions / refresh the abbreviation cache on launch and on
  // every return to the foreground, whichever tab the user lands on. No-op
  // until a session exists.
  useAutoSync();

  // Still hydrating the persisted session — hold on a paper-coloured screen
  // to avoid a flash of the sign-in screen before redirecting.
  if (loading) return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  // An expired session lands on sign-in with an explanation (see sign-in.tsx).
  if (!session) {
    return <Redirect href={signedOutReason === 'expired' ? '/(auth)/sign-in?reason=expired' : '/(auth)/sign-in'} />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.graphite,
        tabBarInactiveTintColor: colors.lead,
        tabBarStyle: { backgroundColor: colors.paper, borderTopColor: colors.graphite },
        tabBarLabelStyle: { fontFamily: fontMono, fontSize: 11, letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('log.title'),
          tabBarIcon: ({ color, size }) => <Feather name="edit-3" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('history.title'),
          tabBarIcon: ({ color, size }) => <Feather name="clock" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t('stats.title'),
          tabBarIcon: ({ color, size }) => <Feather name="trending-up" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t('you.title'),
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
