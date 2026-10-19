import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useStore } from '../state/store';
import { usePeriod } from '../state/period';
import { availableYears, daysInMonth, type PeriodView } from '../lib/analytics';
import { MONTH_LABELS } from '../lib/utils';
import { useNeo } from '../lib/themeMode';
import { colors, font, neoStyles, radius, spacing } from '../theme';

const VIEWS: { key: PeriodView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All Time' },
];

const MONTH_OPTS = MONTH_LABELS.map((m, i) => ({ label: m, value: i }));

function SelectPill({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: { label: string; value: number }[];
  onSelect: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const isNeo = useNeo();
  return (
    <>
      <Pressable style={[styles.pill, isNeo && neoStyles.raisedSm]} onPress={() => setOpen(true)}>
        <Text style={styles.pillText}>{value}</Text>
        <ChevronDown size={15} color={colors.textDim} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, isNeo && neoStyles.raisedLg]}>
            <FlatList
              data={options}
              keyExtractor={o => String(o.value)}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.option}
                  onPress={() => {
                    onSelect(item.value);
                    setOpen(false);
                  }}>
                  <Text style={styles.optionText}>{item.label}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function PeriodBar() {
  const { expenses } = useStore();
  const { view, year, month, day, setView, setYear, setMonth, setDay } = usePeriod();
  const isNeo = useNeo();

  // Scans every expense, and this bar renders on three screens — memoize.
  const yearOpts = useMemo(
    () => availableYears(expenses).map(y => ({ label: String(y), value: y })),
    [expenses],
  );
  const dayOpts = useMemo(
    () =>
      Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
        label: String(i + 1),
        value: i + 1,
      })),
    [year, month],
  );

  const showYear = view !== 'all';
  const showMonth = view === 'month' || view === 'day';
  const showDay = view === 'day';

  return (
    <View style={styles.wrap}>
      <View style={[styles.segment, isNeo && neoStyles.pressed]}>
        {VIEWS.map(v => {
          const active = view === v.key;
          return (
            <Pressable
              key={v.key}
              onPress={() => setView(v.key)}
              style={[styles.segBtn, active && styles.segBtnActive]}>
              <Text style={[styles.segText, active && styles.segTextActive]}>{v.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {(showYear || showMonth || showDay) && (
        <View style={styles.selectors}>
          {showMonth && (
            <SelectPill value={MONTH_LABELS[month]} options={MONTH_OPTS} onSelect={setMonth} />
          )}
          {showDay && (
            <SelectPill value={String(day)} options={dayOpts} onSelect={setDay} />
          )}
          {showYear && (
            <SelectPill value={String(year)} options={yearOpts} onSelect={setYear} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.primary },
  segText: { color: colors.textDim, fontSize: font.small, fontWeight: '700' },
  segTextActive: { color: '#fff' },
  selectors: { flexDirection: 'row', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 76,
  },
  pillText: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.xl },
  sheet: {
    backgroundColor: '#14152a',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  option: { paddingVertical: 14, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionText: { color: colors.text, fontSize: font.body, fontWeight: '600' },
});
