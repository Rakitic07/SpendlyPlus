import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  X,
  FileText,
  FileSpreadsheet,
  Check,
  Download,
} from 'lucide-react-native';
import { useStore } from '../state/store';
import { usePeriod } from '../state/period';
import { useCurrency } from '../lib/currency';
import {
  availableYears,
  daysInMonth,
  filterByPeriod,
  type PeriodView,
} from '../lib/analytics';
import { MONTH_LABELS } from '../lib/utils';
import { generateReport } from '../lib/report';
import type { ReportSectionKey } from '../lib/report';
import { colors, font, radius, spacing } from '../theme';
import { Button } from './ui';

const VIEWS: { key: PeriodView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
];

const SECTION_DEFS: { key: ReportSectionKey; label: string; note?: string }[] = [
  { key: 'summary', label: 'Summary', note: 'Totals, count & average' },
  { key: 'charts', label: 'Trend chart', note: 'Daily / monthly / yearly' },
  { key: 'categories', label: 'By category' },
  { key: 'payers', label: 'Who paid' },
  { key: 'insights', label: 'Insights', note: 'Biggest, busiest day…' },
  { key: 'transactions', label: 'Transactions', note: 'Full itemised list' },
];

function ChipRow<T extends string | number>({
  items,
  value,
  onSelect,
}: {
  items: { label: string; value: T }[];
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}>
      {items.map(it => {
        const active = it.value === value;
        return (
          <Pressable
            key={String(it.value)}
            onPress={() => onSelect(it.value)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { expenses, name } = useStore();
  const { currency } = useCurrency();
  const p = usePeriod();

  const [format, setFormat] = useState<'pdf' | 'excel'>('pdf');
  const [view, setView] = useState<PeriodView>(p.view);
  const [year, setYear] = useState<number>(p.year);
  const [month, setMonth] = useState<number>(p.month);
  const [day, setDay] = useState<number>(p.day);
  const [sections, setSections] = useState<Record<ReportSectionKey, boolean>>({
    summary: true,
    charts: true,
    categories: true,
    payers: true,
    insights: true,
    transactions: true,
  });
  const [busy, setBusy] = useState(false);

  const years = useMemo(() => availableYears(expenses), [expenses]);
  const count = useMemo(
    () => filterByPeriod(expenses, view, year, month, day).length,
    [expenses, view, year, month, day],
  );

  const now = useMemo(() => new Date(), []);

  // Months that actually have data in a given year. The current month is always
  // offered (even with no data yet) so "This month" is a valid default; every
  // other month only appears once at least one expense exists in it.
  const monthsWithData = useCallback(
    (yr: number): Set<number> => {
      const set = new Set<number>();
      for (const e of expenses) {
        const d = new Date(e.date);
        if (d.getFullYear() === yr) set.add(d.getMonth());
      }
      if (yr === now.getFullYear()) set.add(now.getMonth());
      return set;
    },
    [expenses, now],
  );

  const monthItems = useMemo(() => {
    const set = monthsWithData(year);
    return MONTH_LABELS.map((label, value) => ({ label, value })).filter(o =>
      set.has(o.value),
    );
  }, [monthsWithData, year]);

  // When the year changes, keep the month selection valid: prefer the current
  // month, else fall back to the latest month that has data that year.
  const selectYear = useCallback(
    (y: number) => {
      setYear(y);
      const set = monthsWithData(y);
      if (!set.has(month) && set.size > 0) {
        const next =
          y === now.getFullYear() && set.has(now.getMonth())
            ? now.getMonth()
            : Math.max(...Array.from(set));
        setMonth(next);
      }
    },
    [monthsWithData, month, now],
  );

  // The trend chart section only applies when there's a series (not day view).
  const visibleSections = useMemo(
    () => SECTION_DEFS.filter(s => (s.key === 'charts' ? view !== 'day' : true)),
    [view],
  );

  const toggle = (k: ReportSectionKey) =>
    setSections(prev => ({ ...prev, [k]: !prev[k] }));

  const onGenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await generateReport(expenses, {
        format,
        period: { view, year, month, day },
        sections,
        spaceName: name,
        currencyCode: currency.code,
        currencySymbol: currency.symbol,
        currencyLocale: currency.locale,
      });
      onClose();
      if (res.empty) {
        Alert.alert(
          'Report ready',
          'This period has no transactions — the report is essentially empty.',
        );
      }
    } catch (e) {
      Alert.alert('Could not create report', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Leave room for the sheet header + footer buttons on short screens.
  const { height: winH } = useWindowDimensions();
  const bodyMaxH = Math.max(220, Math.min(460, winH - 300));

  const showYear = view !== 'all';
  const showMonth = view === 'month' || view === 'day';
  const showDay = view === 'day';

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Export report</Text>
              <Text style={styles.subtitle}>
                {count} {count === 1 ? 'transaction' : 'transactions'} · nothing is uploaded
              </Text>
            </View>
            <Pressable onPress={busy ? undefined : onClose} hitSlop={10} style={styles.close}>
              <X size={20} color={colors.textDim} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: bodyMaxH }}>
            {/* Format */}
            <Text style={styles.label}>Format</Text>
            <View style={styles.formatRow}>
              <FormatCard
                active={format === 'pdf'}
                onPress={() => setFormat('pdf')}
                icon={<FileText size={20} color={format === 'pdf' ? '#fff' : colors.textDim} />}
                title="PDF"
                sub="Charts & tables"
              />
              <FormatCard
                active={format === 'excel'}
                onPress={() => setFormat('excel')}
                icon={
                  <FileSpreadsheet size={20} color={format === 'excel' ? '#fff' : colors.textDim} />
                }
                title="Excel"
                sub="Multi-sheet .xlsx"
              />
            </View>

            {/* Period */}
            <Text style={styles.label}>Period</Text>
            <View style={styles.segment}>
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

            {showMonth && (
              <ChipRow items={monthItems} value={month} onSelect={setMonth} />
            )}
            {showDay && (
              <ChipRow
                items={Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
                  label: String(i + 1),
                  value: i + 1,
                }))}
                value={day}
                onSelect={setDay}
              />
            )}
            {showYear && (
              <ChipRow
                items={years.map(y => ({ label: String(y), value: y }))}
                value={year}
                onSelect={selectYear}
              />
            )}

            {/* Sections */}
            <Text style={styles.label}>Include</Text>
            <View style={styles.sectionList}>
              {visibleSections.map(s => {
                const on = sections[s.key];
                return (
                  <Pressable key={s.key} onPress={() => toggle(s.key)} style={styles.sectionRow}>
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Check size={14} color="#fff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sectionLabel}>{s.label}</Text>
                      {s.note ? <Text style={styles.sectionNote}>{s.note}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <Button
            label={busy ? 'Generating…' : `Generate ${format === 'pdf' ? 'PDF' : 'Excel'}`}
            onPress={onGenerate}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />

          {busy && (
            <View style={styles.busyRow}>
              <Download size={14} color={colors.textDim} />
              <Text style={styles.busyText}>
                {`Building your ${format === 'pdf' ? 'PDF' : 'Excel'} on-device…`}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function FormatCard({
  active,
  onPress,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.formatCard, active && styles.formatCardActive]}>
      <View style={[styles.formatIcon, active && styles.formatIconActive]}>{icon}</View>
      <Text style={[styles.formatTitle, active && { color: colors.text }]}>{title}</Text>
      <Text style={styles.formatSub}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    // Nearly-opaque so the sheet reads as a solid translucent panel (the old
    // 0.72 chrome let too much of the screen bleed through and looked washed out).
    backgroundColor: 'rgba(16,16,28,0.98)',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  subtitle: { color: colors.textFaint, fontSize: font.tiny, marginTop: 3 },
  close: { padding: 4 },
  label: {
    color: colors.textDim,
    fontSize: font.small,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  formatRow: { flexDirection: 'row', gap: spacing.md },
  formatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  formatCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  formatIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  formatIconActive: { backgroundColor: colors.primary },
  formatTitle: { color: colors.textDim, fontSize: font.body, fontWeight: '800' },
  formatSub: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
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
  chipRow: { gap: spacing.sm, paddingVertical: spacing.sm, paddingRight: spacing.md },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary + '33', borderColor: colors.primary },
  chipText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  chipTextActive: { color: colors.text, fontWeight: '700' },
  sectionList: { gap: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sectionLabel: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  sectionNote: { color: colors.textFaint, fontSize: font.tiny, marginTop: 1 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: spacing.sm },
  busyText: { color: colors.textDim, fontSize: font.small },
});
