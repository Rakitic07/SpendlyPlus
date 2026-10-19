import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LayoutDashboard, PieChart, ListChecks } from 'lucide-react-native';
import { useNeo } from '../lib/themeMode';
import { colors, font, neo, spacing } from '../theme';

const ICONS: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Overview: LayoutDashboard,
  Charts: PieChart,
  Activity: ListChecks,
};

const LABELS: Record<string, string> = {
  Overview: 'Overview',
  Charts: 'Charts',
  Activity: 'Activity',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isNeo = useNeo();

  return (
    <View
      style={[
        styles.wrap,
        isNeo && styles.wrapNeo,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const Icon = ICONS[route.name];
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const evt = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !evt.defaultPrevented) navigation.navigate(route.name);
              }}
              android_ripple={{ color: 'rgba(255,255,255,0.1)', borderless: true, radius: 36 }}
              style={styles.tab}>
              <Icon size={25} color={focused ? colors.primary : colors.textFaint} />
              <Text style={[styles.label, focused && { color: colors.text }]}>
                {LABELS[route.name]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  wrapNeo: {
    backgroundColor: neo.bg,
    borderTopColor: neo.hairline,
    boxShadow: `0px -6px 14px ${neo.dark}`,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: spacing.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4, gap: 3 },
  label: { color: colors.textFaint, fontSize: font.tiny, fontWeight: '600' },
});
