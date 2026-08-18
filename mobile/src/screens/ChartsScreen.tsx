import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { matchFont } from '@shopify/react-native-skia';
import { CartesianChart, Bar, Line, PolarChart, Pie } from 'victory-native';
import { Download } from 'lucide-react-native';
import { useStore } from '../state/store';
import { usePeriod } from '../state/period';
import { useCurrency } from '../lib/currency';
import {
  byCategory,
  byPaidBy,
  dailyTotals,
  monthlyTrend,
  yearlyTotals,
  filterByPeriod,
  periodLabel,
  sum,
  type Slice,
} from '../lib/analytics';
import { PeriodBar } from '../components/PeriodBar';
import { ReportModal } from '../components/ReportModal';
import { Skeleton } from '../components/Shimmer';
import { Card } from '../components/ui';
import { colors, font, radius, spacing } from '../theme';

type DonutDatum = { label: string; value: number; color: string };

function toDonut(slices: Slice[]): DonutDatum[] {
  const top = slices.slice(0, 6);
  const rest = slices.slice(6);
  const data = top.map(c => ({ label: c.name, value: c.value, color: c.color }));
  if (rest.length) {
    data.push({ label: 'Other', value: rest.reduce((a, c) => a + c.value, 0), color: '#adb5bd' });
  }
  return data;
}

function DonutCard({ title, data, total }: { title: string; data: DonutDatum[]; total: number }) {
  const { format } = useCurrency();
  return (
    <Card strong style={{ marginTop: spacing.md }}>
      <Text style={styles.section}>{title}</Text>
      {total > 0 ? (
        <View style={styles.donutRow}>
          <View style={{ width: 140, height: 140 }}>
            <PolarChart data={data} labelKey="label" valueKey="value" colorKey="color">
              <Pie.Chart innerRadius="62%" />
            </PolarChart>
          </View>
          <View style={styles.legend}>
            {data.map(d => (
              <View key={d.label} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: d.color }]} />
                <Text style={styles.legendLabel} numberOfLines={1}>
                  {d.label}
                </Text>
                <Text style={styles.legendVal}>{format(d.value)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Text style={styles.empty}>No data for this period yet.</Text>
      )}
    </Card>
  );
}

export function ChartsScreen() {
  const { expenses, syncing } = useStore();
  const { view, year, month, day } = usePeriod();
  const { width } = useWindowDimensions();
  const chartWidth = width - spacing.lg * 4;
  const [reportOpen, setReportOpen] = useState(false);

  const scoped = useMemo(
    () => filterByPeriod(expenses, view, year, month, day),
    [expenses, view, year, month, day],
  );
  const total = useMemo(() => sum(scoped), [scoped]);
  const cats = useMemo(() => toDonut(byCategory(scoped)), [scoped]);
  const payers = useMemo(() => toDonut(byPaidBy(scoped)), [scoped]);
  const label = periodLabel(view, year, month, day);

  // Bar series adapts to the selected view (day view has no meaningful trend).
  // `barLabels` runs parallel to `bars` (index → x-axis tick text) so the graphs
  // show real date references (day / month / year) instead of bare positions.
  const { bars, barTitle, barLabels } = useMemo(() => {
    if (view === 'month') {
      const rows = dailyTotals(expenses, year, month);
      return {
        barTitle: 'Daily spending',
        bars: rows.map((r, i) => ({ x: i + 1, y: Math.round(r.total) })),
        barLabels: rows.map(r => r.day), // "1".."31"
      };
    }
    if (view === 'year') {
      const rows = monthlyTrend(expenses, year);
      return {
        barTitle: 'Monthly spending',
        bars: rows.map((r, i) => ({ x: i + 1, y: Math.round(r.total) })),
        barLabels: rows.map(r => r.month.slice(0, 3)), // "Jan".."Dec"
      };
    }
    if (view === 'all') {
      const rows = yearlyTotals(expenses);
      return {
        barTitle: 'Yearly spending',
        bars: rows.map((r, i) => ({ x: i + 1, y: Math.round(r.total) })),
        barLabels: rows.map(r => r.year), // "2024"
      };
    }
    return { barTitle: '', bars: [] as { x: number; y: number }[], barLabels: [] as string[] };
  }, [expenses, view, year, month]);

  // Thin the ticks so labels never overlap: at most ~8, always incl. first & last.
  const xTicks = useMemo(() => {
    const n = bars.length;
    if (n === 0) return [] as number[];
    const maxTicks = 8;
    if (n <= maxTicks) return bars.map(b => b.x);
    const step = Math.ceil(n / maxTicks);
    const ticks: number[] = [];
    for (let i = 0; i < n; i += step) ticks.push(i + 1);
    if (ticks[ticks.length - 1] !== n) ticks.push(n);
    return ticks;
  }, [bars]);

  // Skia needs a real font to draw axis labels; matchFont uses a system font so
  // we don't have to bundle a .ttf.
  const axisFont = useMemo(
    () => matchFont({ fontFamily: Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif', fontSize: 10 }),
    [],
  );
  const formatX = (v: number) => barLabels[Math.round(v) - 1] ?? '';
  const formatY = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
    return String(Math.round(v));
  };
  const xAxis = {
    font: axisFont,
    tickValues: xTicks,
    formatXLabel: formatX,
    lineColor: 'rgba(255,255,255,0.10)',
    labelColor: colors.textDim,
    labelOffset: 4,
  };
  const yAxis = [
    {
      font: axisFont,
      tickCount: 4,
      formatYLabel: formatY,
      lineColor: 'rgba(255,255,255,0.06)',
      labelColor: colors.textFaint,
    },
  ];

  const cumulative = useMemo(() => {
    let run = 0;
    return bars.map(b => {
      run += b.y;
      return { x: b.x, y: run };
    });
  }, [bars]);

  const hasBars = bars.some(b => b.y > 0);
  const showTrend = view !== 'day';
  const firstLoading = expenses.length === 0 && syncing;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Insights</Text>
          <Pressable onPress={() => setReportOpen(true)} style={styles.reportBtn} hitSlop={6}>
            <Download size={15} color={colors.primary} />
            <Text style={styles.reportBtnText}>Report</Text>
          </Pressable>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <PeriodBar />
        </View>

        {firstLoading ? (
          <>
            <Card strong style={{ marginTop: spacing.md }}>
              <Skeleton width="55%" height={13} />
              <View style={styles.skelDonutRow}>
                <Skeleton width={140} height={140} radius={70} />
                <View style={styles.skelLegend}>
                  <Skeleton width="80%" height={12} />
                  <Skeleton width="65%" height={12} />
                  <Skeleton width="72%" height={12} />
                  <Skeleton width="50%" height={12} />
                </View>
              </View>
            </Card>
            <Card strong style={{ marginTop: spacing.md }}>
              <Skeleton width="45%" height={13} />
              <Skeleton width="100%" height={200} radius={radius.md} style={{ marginTop: spacing.md }} />
            </Card>
          </>
        ) : null}

        {!firstLoading && (
          <>
        <DonutCard title={`Spending by category · ${label}`} data={cats} total={total} />

        {showTrend && (
          <Card strong style={{ marginTop: spacing.md }}>
            <Text style={styles.section}>{barTitle}</Text>
            {hasBars ? (
              <View style={{ height: 210, width: chartWidth }}>
                <CartesianChart
                  data={bars}
                  xKey="x"
                  yKeys={['y']}
                  domainPadding={{ left: 14, right: 14, top: 20 }}
                  xAxis={xAxis}
                  yAxis={yAxis}>
                  {({ points, chartBounds }) => (
                    <Bar
                      points={points.y}
                      chartBounds={chartBounds}
                      color={colors.primary}
                      roundedCorners={{ topLeft: 4, topRight: 4 }}
                    />
                  )}
                </CartesianChart>
              </View>
            ) : (
              <Text style={styles.empty}>No data for this period yet.</Text>
            )}
          </Card>
        )}

        {showTrend && (
          <Card strong style={{ marginTop: spacing.md }}>
            <Text style={styles.section}>Cumulative trend</Text>
            {hasBars ? (
              <View style={{ height: 210, width: chartWidth }}>
                <CartesianChart
                  data={cumulative}
                  xKey="x"
                  yKeys={['y']}
                  domainPadding={{ left: 8, right: 8, top: 20 }}
                  xAxis={xAxis}
                  yAxis={yAxis}>
                  {({ points }) => (
                    <Line points={points.y} color={colors.green} strokeWidth={2.5} curveType="natural" />
                  )}
                </CartesianChart>
              </View>
            ) : (
              <Text style={styles.empty}>No data for this period yet.</Text>
            )}
          </Card>
        )}

        <DonutCard title={`Who paid · ${label}`} data={payers} total={total} />
          </>
        )}
      </ScrollView>

      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  title: { color: colors.text, fontSize: font.h2, fontWeight: '800' },
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
  section: { color: colors.textDim, fontSize: font.small, fontWeight: '700', marginBottom: spacing.md },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { color: colors.textDim, fontSize: font.small, flex: 1 },
  legendVal: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  empty: { color: colors.textFaint, textAlign: 'center', padding: spacing.lg },
  skelDonutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  skelLegend: { flex: 1, gap: 12 },
});
