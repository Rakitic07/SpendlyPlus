import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useNeo } from '../lib/themeMode';
import { colors, font, neoStyles, radius, spacing } from '../theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parse(value: string): { y: number; m: number; d: number } {
  const [y, m, d] = value.split('-').map(Number);
  const now = new Date();
  return {
    y: y || now.getFullYear(),
    m: (m || now.getMonth() + 1) - 1,
    d: d || now.getDate(),
  };
}

// Lightweight, dependency-free calendar. Shows a tappable field; opens a month
// grid to pick a date. Value/onChange use ISO "YYYY-MM-DD".
export function DatePickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const sel = parse(value);
  const isNeo = useNeo();
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(sel.y);
  const [viewM, setViewM] = useState(sel.m);

  const label = new Date(sel.y, sel.m, sel.d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const openCal = () => {
    setViewY(sel.y);
    setViewM(sel.m);
    setOpen(true);
  };

  const shift = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewM(m);
    setViewY(y);
  };

  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const days = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  const pick = (d: number) => {
    onChange(`${viewY}-${pad(viewM + 1)}-${pad(d)}`);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={[styles.field, isNeo && neoStyles.pressed]}
        onPress={openCal}
        accessibilityRole="button"
        accessibilityLabel={`Date: ${label}`}>
        <Text style={styles.fieldText} numberOfLines={1}>
          {label}
        </Text>
        <CalendarDays size={18} color={colors.textDim} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.card, isNeo && neoStyles.raisedLg]} onPress={() => {}}>
            <View style={styles.header}>
              <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.nav}>
                <ChevronLeft size={22} color={colors.text} />
              </Pressable>
              <Text style={styles.headerText}>
                {MONTHS[viewM]} {viewY}
              </Text>
              <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.nav}>
                <ChevronRight size={22} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={i} style={styles.weekday}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((c, i) => {
                if (c == null) return <View key={i} style={styles.cell} />;
                const isSel = c === sel.d && viewM === sel.m && viewY === sel.y;
                return (
                  <Pressable key={i} style={styles.cell} onPress={() => pick(c)}>
                    <View style={[styles.dayDot, isSel && styles.dayDotActive]}>
                      <Text style={[styles.dayText, isSel && styles.dayTextActive]}>{c}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.today}
              onPress={() => {
                const n = new Date();
                onChange(`${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`);
                setOpen(false);
              }}>
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const CELL = `${100 / 7}%`;

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
  },
  fieldText: { color: colors.text, fontSize: font.body, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: '#14152a',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  headerText: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  nav: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { width: CELL, textAlign: 'center', color: colors.textFaint, fontSize: font.tiny, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayDotActive: { backgroundColor: colors.primary },
  dayText: { color: colors.text, fontSize: font.body },
  dayTextActive: { color: '#fff', fontWeight: '800' },
  today: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  todayText: { color: colors.text, fontSize: font.small, fontWeight: '700' },
});
