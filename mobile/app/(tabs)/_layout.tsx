import { Redirect, Tabs } from 'expo-router';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { colors, fontMono } from '@/lib/theme';

export default function TabsLayout() {
  const { session, loading } = useAuth();
  const { t } = useTranslation();

  // Still hydrating the persisted session — hold on a paper-coloured screen
  // to avoid a flash of the sign-in screen before redirecting.
  if (loading) return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

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
        name="stats"
        options={{
          title: t('stats.title'),
          tabBarIcon: ({ color, size }) => <Feather name="bar-chart-2" size={size} color={color} />,
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
        name="you"
        options={{
          title: t('you.title'),
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
