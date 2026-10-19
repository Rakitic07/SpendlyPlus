import React, { useEffect, useRef, useState } from 'react';
import { Animated, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { StoreProvider, useStore } from './src/state/store';
import { PeriodProvider } from './src/state/period';
import { UpdatesProvider } from './src/state/updates';
import { CurrencyProvider } from './src/lib/currency';
import { SettingsProvider } from './src/lib/settings';
import { AuthScreen } from './src/screens/AuthScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { ChartsScreen } from './src/screens/ChartsScreen';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { ExpenseFormScreen } from './src/screens/ExpenseFormScreen';
import { TabBar } from './src/components/TabBar';
import { FloatingAddButton } from './src/components/FloatingAddButton';
import { Background } from './src/components/Background';
import type { RootStackParamList, TabParamList } from './src/navigation';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// Transparent so the global gradient Background shows through every screen.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent', primary: colors.primary },
};

function Tabs() {
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        tabBar={props => <TabBar {...props} />}
        screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true }}>
        <Tab.Screen name="Overview" component={OverviewScreen} />
        <Tab.Screen name="Charts" component={ChartsScreen} />
        <Tab.Screen name="Activity" component={ActivityScreen} />
      </Tab.Navigator>
      <FloatingAddButton />
    </View>
  );
}

function Splash() {
  // Gentle fade + rise so the wordmark feels like a real launch screen instead
  // of a single-frame flash.
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, damping: 12, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <View style={styles.splash}>
      <Animated.Text style={[styles.logo, { opacity, transform: [{ translateY }] }]}>
        Spendly+
      </Animated.Text>
      <Animated.Text style={[styles.splashTag, { opacity }]}>
        Track spending. Beautifully.
      </Animated.Text>
    </View>
  );
}

function Root() {
  const { status, name } = useStore();
  // Keep the splash up for a short beat so it never vanishes in a single frame,
  // even when we resolve auth instantly from cache.
  const [minSplashDone, setMinSplashDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinSplashDone(true), 450);
    return () => clearTimeout(t);
  }, []);

  if (status === 'loading' || !minSplashDone) return <Splash />;
  if (status === 'guest') return <AuthScreen />;

  return (
    <CurrencyProvider space={name}>
      <SettingsProvider space={name}>
      <PeriodProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={Tabs} />
          <Stack.Screen
            name="ExpenseForm"
            component={ExpenseFormScreen}
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack.Navigator>
      </PeriodProvider>
      </SettingsProvider>
    </CurrencyProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={styles.root}>
          <Background />
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          <NavigationContainer theme={navTheme}>
            <UpdatesProvider>
              <StoreProvider>
                <Root />
              </StoreProvider>
            </UpdatesProvider>
          </NavigationContainer>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { color: colors.primary, fontSize: 40, fontWeight: '800', letterSpacing: 0.5 },
  splashTag: { color: 'rgba(244,244,255,0.55)', fontSize: 13, marginTop: 10 },
});
