import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  History,
  Image as ImageIcon,
  Trash2,
  Wallet,
  User,
  RotateCcw,
  Palette,
  Sparkles,
  Vibrate,
} from 'lucide-react-native';
import { useSettings } from '../lib/settings';
import { useNeo, type ThemeName } from '../lib/themeMode';
import type { PeriodView } from '../lib/analytics';
import { colors, font, neo, neoStyles, radius, spacing } from '../theme';

const PERIODS: { value: PeriodView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'glass', label: 'Liquid glass' },
  { value: 'neo', label: 'Soft Aurora' },
];

function Row({
  icon,
  title,
  desc,
  stacked,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  /** Put the control under the title (for wide segmented pickers). */
  stacked?: boolean;
  children: React.ReactNode;
}) {
  const isNeo = useNeo();
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <View style={styles.rowLeft}>
        <View style={[styles.rowIcon, isNeo && neoStyles.raisedSm]}>{icon}</View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{title}</Text>
          {desc ? <Text style={styles.rowDesc}>{desc}</Text> : null}
        </View>
      </View>
      <View style={stacked ? styles.rowBelow : styles.rowRight}>{children}</View>
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const isNeo = useNeo();
  return (
    <View style={styles.periodRow}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.periodChip,
              isNeo && (active ? neoStyles.pressed : neoStyles.raisedSm),
              active && (isNeo ? { borderColor: colors.primary } : styles.periodChipActive),
            ]}>
            <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update, reset } = useSettings();
  const insets = useSafeAreaInsets();
  const isNeo = useNeo();

  const track = { false: colors.border, true: colors.primary };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            isNeo && { backgroundColor: neo.bg },
            { paddingBottom: spacing.xl + insets.bottom },
          ]}>
          <View style={styles.header}>
            <View style={styles.rowText}>
              <Text style={styles.title}>Space settings</Text>
              <Text style={styles.subtitle}>Synced for this space across your devices</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              style={[styles.closeBtn, isNeo && neoStyles.raisedSm]}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Row
              stacked
              icon={<Palette size={16} color={colors.primary} />}
              title="Appearance"
              desc="Soft Aurora is a neumorphic look in the same violet–pink palette">
              <Segmented options={THEMES} value={settings.theme} onChange={v => update({ theme: v })} />
            </Row>

            <Row icon={<History size={16} color={colors.primary} />} title="Default period" desc="Which range the app opens on" stacked>
              <Segmented
                options={PERIODS}
                value={settings.defaultPeriod}
                onChange={v => update({ defaultPeriod: v })}
              />
            </Row>

            <Row icon={<ImageIcon size={16} color={colors.primary} />} title="Show bill thumbnails" desc="Tiny scanned-receipt previews on rows and edits">
              <Switch
                value={settings.showThumbnails}
                onValueChange={v => update({ showThumbnails: v })}
                trackColor={track}
                thumbColor="#fff"
              />
            </Row>

            <Row icon={<Trash2 size={16} color={colors.primary} />} title="Confirm before delete" desc="Ask before removing an expense">
              <Switch
                value={settings.confirmDelete}
                onValueChange={v => update({ confirmDelete: v })}
                trackColor={track}
                thumbColor="#fff"
              />
            </Row>

            <Row icon={<Sparkles size={16} color={colors.primary} />} title="Recent title suggestions" desc="Quick-fill chips from your recent expenses">
              <Switch
                value={settings.recentSuggestions}
                onValueChange={v => update({ recentSuggestions: v })}
                trackColor={track}
                thumbColor="#fff"
              />
            </Row>

            <Row icon={<Wallet size={16} color={colors.primary} />} title="Budget alerts" desc="Warn as spending nears or passes the budget">
              <Switch
                value={settings.budgetAlerts}
                onValueChange={v => update({ budgetAlerts: v })}
                trackColor={track}
                thumbColor="#fff"
              />
            </Row>

            <Row icon={<User size={16} color={colors.primary} />} title="Default “Paid by”" desc="Pre-fills the payer for new expenses">
              <TextInput
                value={settings.defaultPayer}
                onChangeText={t => update({ defaultPayer: t })}
                placeholder="e.g. Me"
                placeholderTextColor={colors.textFaint}
                maxLength={40}
                style={[styles.input, isNeo && neoStyles.pressed]}
              />
            </Row>

            <Row icon={<Vibrate size={16} color={colors.primary} />} title="Haptic feedback" desc="A gentle tap on add / delete">
              <Switch
                value={settings.haptics}
                onValueChange={v => update({ haptics: v })}
                trackColor={track}
                thumbColor="#fff"
              />
            </Row>

            <Pressable
              onPress={reset}
              style={({ pressed }) => [
                styles.resetBtn,
                isNeo && (pressed ? neoStyles.pressed : neoStyles.raisedSm),
              ]}>
              <RotateCcw size={16} color={colors.textDim} />
              <Text style={styles.resetText}>Reset to defaults</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: 'rgba(16,16,28,0.98)',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  closeBtn: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  rowIcon: {
    height: 32,
    width: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowDesc: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  rowRight: { flexShrink: 0 },
  rowBelow: { paddingLeft: 32 + spacing.sm },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  periodChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipActive: { backgroundColor: colors.primary + '33', borderColor: colors.primary },
  periodChipText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  periodChipTextActive: { color: colors.text, fontWeight: '700' },
  input: {
    width: 120,
    color: colors.text,
    fontSize: font.body,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resetText: { color: colors.textDim, fontSize: font.small, fontWeight: '700' },
});
