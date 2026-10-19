import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Expense } from '../lib/types';
import { categoryMeta } from '../lib/categories';
import { paymentLabel } from '../lib/payments';
import { useCurrency } from '../lib/currency';
import { useSettings } from '../lib/settings';
import { colors, font, radius, spacing } from '../theme';

function ExpenseRowBase({ e, onPress }: { e: Expense; onPress?: (e: Expense) => void }) {
  const { format } = useCurrency();
  const { settings } = useSettings();
  const meta = categoryMeta(e.category);
  const sub = [
    e.category,
    e.paidBy,
    paymentLabel(e.paymentMode, e.paymentDetail),
    e.notes ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  const pending = e.id.startsWith('local-');

  return (
    <Pressable
      onPress={() => onPress?.(e)}
      android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
      style={styles.row}>
      {e.thumbnail && settings.showThumbnails ? (
        <Image source={{ uri: e.thumbnail }} style={styles.thumb} resizeMode="cover" resizeMethod="resize" />
      ) : (
        <View style={[styles.icon, { backgroundColor: meta.color + '22' }]}>
          <Text style={styles.emoji}>{meta.emoji}</Text>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.title}>
          {e.title}
          {pending ? '  ·  ⏳' : ''}
        </Text>
        <Text numberOfLines={1} style={styles.sub}>
          {sub}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '45%' }}>
        <Text style={styles.amount} numberOfLines={1}>
          {format(e.amount)}
        </Text>
        <Text style={styles.date}>
          {new Date(e.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </Text>
      </View>
    </Pressable>
  );
}

export const ExpenseRow = React.memo(ExpenseRowBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 20 },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  sub: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  amount: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  date: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
});
