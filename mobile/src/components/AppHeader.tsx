import React, { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, LogOut, Check, Settings } from 'lucide-react-native';
import { useStore } from '../state/store';
import { CURRENCIES, useCurrency } from '../lib/currency';
import { useNeo } from '../lib/themeMode';
import { SettingsModal } from './SettingsModal';
import { colors, font, neo, neoStyles, radius, spacing } from '../theme';

export function AppHeader({ title }: { title: string }) {
  const { online, syncing, refresh, logout, pendingCount } = useStore();
  // Locking clears the offline queue, so warn before discarding unsynced work.
  const confirmLogout = () => {
    if (pendingCount === 0) {
      void logout();
      return;
    }
    Alert.alert(
      'Unsynced changes',
      `${pendingCount} ${pendingCount === 1 ? 'change hasn\'t' : 'changes haven\'t'} reached the server yet. Locking now will discard ${pendingCount === 1 ? 'it' : 'them'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lock anyway', style: 'destructive', onPress: () => void logout() },
      ],
    );
  };
  const { currency, setCurrency } = useCurrency();
  const [picker, setPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const isNeo = useNeo();

  const dot = syncing ? colors.amber : online ? colors.green : colors.red;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleBox}>
        <Text style={styles.brand}>Spendly+</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => setPicker(true)}
          accessibilityRole="button"
          accessibilityLabel={`Currency: ${currency.code}`}
          style={[styles.chip, isNeo && neoStyles.raisedSm]}>
          <Text style={styles.chipText}>{currency.code}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Space settings"
          style={[styles.iconBtn, isNeo && [neoStyles.raisedSm, styles.iconBtnNeo]]}>
          <Settings size={18} color={colors.textDim} />
        </Pressable>
        <Pressable
          onPress={refresh}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Sync now"
          style={[styles.iconBtn, isNeo && [neoStyles.raisedSm, styles.iconBtnNeo]]}>
          <View style={[styles.syncDot, { backgroundColor: dot }]} />
          <RefreshCw size={16} color={colors.textDim} />
        </Pressable>
        <Pressable
          onPress={confirmLogout}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Lock space"
          style={[styles.iconBtn, isNeo && [neoStyles.raisedSm, styles.iconBtnNeo]]}>
          <LogOut size={18} color={colors.textDim} />
        </Pressable>
      </View>

      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(false)}>
          {/* Swallow taps inside the sheet so only the backdrop closes it. */}
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              isNeo && { backgroundColor: neo.bg },
              { paddingBottom: spacing.xl + insets.bottom },
            ]}>
            <Text style={styles.sheetTitle}>Currency</Text>
            {CURRENCIES.map(c => (
              <Pressable
                key={c.code}
                onPress={() => {
                  setCurrency(c.code);
                  setPicker(false);
                }}
                style={styles.currRow}>
                <Text style={styles.currText}>
                  {c.symbol}  {c.label}
                </Text>
                {currency.code === c.code ? <Check size={18} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  titleBox: { flexShrink: 1, minWidth: 0 },
  brand: { color: colors.text, fontSize: font.h2, fontWeight: '800' },
  sub: { color: colors.textFaint, fontSize: font.tiny },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: { color: colors.text, fontWeight: '700', fontSize: font.small },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  iconBtnNeo: { borderRadius: radius.pill, borderWidth: 1 },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#12121f',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
  },
  sheetTitle: { color: colors.text, fontSize: font.h3, fontWeight: '800', marginBottom: spacing.md },
  currRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  currText: { color: colors.text, fontSize: font.body },
});
