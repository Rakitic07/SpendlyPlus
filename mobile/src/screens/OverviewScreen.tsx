import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Download, AlertTriangle } from 'lucide-react-native';
import { useStore } from '../state/store';
import { usePeriod } from '../state/period';
import { useCurrency } from '../lib/currency';
import { useSettings } from '../lib/settings';
import { inDay, sum, byCategory, filterByPeriod, periodLabel } from '../lib/analytics';
import { AppHeader } from '../components/AppHeader';
import { PeriodBar } from '../components/PeriodBar';
import { BudgetRing } from '../components/BudgetRing';
import { ExpenseRow } from '../components/ExpenseRow';
import { Footer } from '../components/Footer';
import { ReportModal } from '../components/ReportModal';
import { SkeletonRows } from '../components/Shimmer';
import { Button, Card } from '../components/ui';
import { colors, font, radius, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

export function OverviewScreen() {
  const { expenses, budget, name, saveBudget, syncing } = useStore();
  const { view, year, month, day } = usePeriod();
  const { format } = useCurrency();
  const { settings } = useSettings();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [reportOpen, setReportOpen] = useState(false);

  const scoped = useMemo(
    () => filterByPeriod(expenses, view, year, month, day),
    [expenses, view, year, month, day],
  );
  const periodTotal = useMemo(() => sum(scoped), [scoped]);
  const topCats = useMemo(() => byCategory(scoped).slice(0, 4), [scoped]);
  const todayTotal = useMemo(
    () => sum(expenses.filter(e => inDay(e, new Date().toISOString()))),
    [expenses],
  );

  const label = periodLabel(view, year, month, day);
  const isMonth = view === 'month';
  // Budget only makes sense for a single month.
  const pct = isMonth && budget && budget > 0 ? periodTotal / budget : 0;
  const remaining = isMonth && budget != null ? budget - periodTotal : null;
  const recent = scoped.slice(0, 5);

  const openBudget = () => {
    setBudgetInput(budget != null ? String(budget) : '');
    setBudgetModal(true);
  };
  const commitBudget = () => {
    const n = Number(budgetInput);
    void saveBudget(budgetInput.trim() === '' ? null : Number.isFinite(n) ? n : null);
    setBudgetModal(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppHeader title={name} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <PeriodBar />

        <Card strong style={[styles.hero, { marginTop: spacing.md }]}>
          <BudgetRing
            pct={pct}
            centerTop={isMonth && budget ? 'This month' : label}
            centerMain={format(periodTotal)}
            centerSub={
              isMonth && budget
                ? remaining != null && remaining >= 0
                  ? `${format(remaining)} left`
                  : `${format(Math.abs(remaining ?? 0))} over`
                : `${scoped.length} ${scoped.length === 1 ? 'entry' : 'entries'}`
            }
          />
          <View style={styles.heroSide}>
            <StatCard label="Today" value={format(todayTotal)} />
            <StatCard label={label} value={format(periodTotal)} accent={colors.primary} />
            <Pressable onPress={openBudget} style={styles.budgetBtn}>
              <Text style={styles.budgetBtnText}>
                {budget != null ? 'Edit budget' : 'Set budget'}
              </Text>
            </Pressable>
          </View>
        </Card>

        {settings.budgetAlerts && isMonth && budget != null && budget > 0 && periodTotal >= budget * 0.9 && (
          <View style={[styles.alert, periodTotal > budget ? styles.alertOver : styles.alertNear]}>
            <AlertTriangle size={16} color={periodTotal > budget ? colors.red : colors.amber} />
            <Text style={styles.alertText}>
              {periodTotal > budget
                ? `You're ${format(periodTotal - budget)} over your monthly budget.`
                : `You've used ${Math.round((periodTotal / budget) * 100)}% of your monthly budget.`}
            </Text>
          </View>
        )}

        {topCats.length > 0 && (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={styles.sectionTitle}>Top categories · {label}</Text>
            {topCats.map(c => {
              const share = periodTotal > 0 ? c.value / periodTotal : 0;
              return (
                <View key={c.name} style={styles.catRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.catHead}>
                      <Text style={styles.catName}>{c.name}</Text>
                      <Text style={styles.catVal}>{format(c.value)}</Text>
                    </View>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          { width: `${Math.round(share * 100)}%`, backgroundColor: c.color },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        <View style={styles.recentHead}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <Pressable onPress={() => setReportOpen(true)} style={styles.reportBtn} hitSlop={6}>
            <Download size={15} color={colors.primary} />
            <Text style={styles.reportBtnText}>Report</Text>
          </Pressable>
        </View>
        <Card style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.xs }}>
          {recent.length === 0 ? (
            expenses.length === 0 && syncing ? (
              <SkeletonRows count={4} />
            ) : (
              <Text style={styles.empty}>No expenses yet. Tap + to add one.</Text>
            )
          ) : (
            recent.map(e => (
              <ExpenseRow key={e.id} e={e} onPress={ex => nav.navigate('ExpenseForm', { expense: ex })} />
            ))
          )}
        </Card>

        <Footer />
      </ScrollView>

      <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setBudgetModal(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Monthly budget</Text>
            <TextInput
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 30000 (blank to clear)"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
            <Button label="Save" onPress={commitBudget} style={{ marginTop: spacing.md }} />
          </View>
        </Pressable>
      </Modal>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  heroSide: { flex: 1, gap: spacing.sm },
  stat: {},
  statLabel: { color: colors.textFaint, fontSize: font.tiny, fontWeight: '600' },
  statValue: { color: colors.text, fontSize: font.h3, fontWeight: '800', marginTop: 2 },
  budgetBtn: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  budgetBtnText: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  alertNear: { backgroundColor: colors.amber + '1a', borderColor: colors.amber + '55' },
  alertOver: { backgroundColor: colors.red + '1a', borderColor: colors.red + '55' },
  alertText: { flex: 1, color: colors.text, fontSize: font.small, fontWeight: '600' },
  sectionTitle: { color: colors.text, fontSize: font.h3, fontWeight: '800', marginBottom: spacing.sm },
  catRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  catName: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  catVal: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  recentHead: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    backgroundColor: colors.primary + '1f',
  },
  reportBtnText: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
  empty: { color: colors.textFaint, textAlign: 'center', padding: spacing.lg, fontSize: font.small },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetTitle: { color: colors.text, fontSize: font.h3, fontWeight: '800', marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
    color: colors.text,
    fontSize: font.body,
  },
});
