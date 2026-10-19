import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Plus } from 'lucide-react-native';
import { useNeo } from '../lib/themeMode';
import { colors, neo } from '../theme';
import type { RootStackParamList } from '../navigation';

const SIZE = 62;

// Material-style floating action button on the bottom-right, filled with the
// brand violet→pink gradient (matches the old app's pink add button).
export function FloatingAddButton() {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isNeo = useNeo();

  return (
    <Pressable
      onPress={() => nav.navigate('ExpenseForm')}
      accessibilityRole="button"
      accessibilityLabel="Add expense"
      android_ripple={{ color: 'rgba(255,255,255,0.28)', borderless: true, radius: SIZE / 2 }}
      style={[styles.fab, isNeo && styles.fabNeo, { bottom: insets.bottom + 84 }]}>
      <Svg width={SIZE} height={SIZE}>
        <Defs>
          <LinearGradient id="fabGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.primary} />
            <Stop offset="1" stopColor={colors.primary2} />
          </LinearGradient>
        </Defs>
        <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 1} fill="url(#fabGrad)" />
      </Svg>
      <View style={styles.iconWrap} pointerEvents="none">
        <Plus size={30} color="#fff" strokeWidth={2.6} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Soft pink glow like a real FAB.
    elevation: 8,
    shadowColor: colors.primary2,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabNeo: {
    elevation: 0,
    shadowOpacity: 0,
    boxShadow: `6px 6px 14px ${neo.dark}, -5px -5px 12px ${neo.light}`,
  },
  iconWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
