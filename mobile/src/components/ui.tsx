import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useNeo } from '../lib/themeMode';
import { colors, font, neoStyles, radius, spacing } from '../theme';

export function Card({
  children,
  style,
  strong,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  strong?: boolean;
}) {
  const isNeo = useNeo();
  return (
    <View
      style={[
        styles.card,
        strong && styles.cardStrong,
        isNeo && (strong ? neoStyles.raisedLg : neoStyles.raised),
        style,
      ]}>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  style,
}: {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  style?: ViewStyle;
}) {
  const isNeo = useNeo();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
      style={({ pressed }) => [
        styles.btn,
        isPrimary && styles.btnPrimary,
        isDanger && styles.btnDanger,
        variant === 'ghost' && styles.btnGhost,
        isNeo && variant === 'ghost' && (pressed ? neoStyles.pressed : neoStyles.raisedSm),
        isNeo && variant !== 'ghost' && !pressed && styles.neoAccentShadow,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={isPrimary || isDanger ? '#fff' : colors.text} />
      ) : (
        <Text
          style={[
            styles.btnText,
            !isPrimary && !isDanger && { color: colors.text },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Pill({
  label,
  active,
  onPress,
  color,
  style,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  style?: ViewStyle;
}) {
  const isNeo = useNeo();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: false }}
      style={[
        styles.pill,
        isNeo && (active ? neoStyles.pressed : neoStyles.raisedSm),
        active &&
          (isNeo
            ? { borderColor: color ?? colors.primary }
            : {
                backgroundColor: (color ?? colors.primary) + '33',
                borderColor: color ?? colors.primary,
              }),
        style,
      ]}>
      <Text
        style={[
          styles.pillText,
          active && { color: colors.text, fontWeight: '700' },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Label({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    // Brighter top edge = frosted-glass sheen.
    borderTopColor: colors.sheen,
    padding: spacing.lg,
  },
  cardStrong: {
    backgroundColor: colors.surface2,
    borderColor: colors.borderStrong,
    borderTopColor: colors.sheen,
  },
  btn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnDanger: { backgroundColor: colors.red },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  neoAccentShadow: { boxShadow: '4px 4px 10px #0e0f1f, -3px -3px 8px #2a2d4c' },
  btnText: { color: '#fff', fontSize: font.body, fontWeight: '700' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  label: { color: colors.textDim, fontSize: font.small, marginBottom: 6, fontWeight: '600' },
});
