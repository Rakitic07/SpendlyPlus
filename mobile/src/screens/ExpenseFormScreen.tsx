import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, Images, X } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useStore } from '../state/store';
import { useCurrency } from '../lib/currency';
import { CATEGORIES, CATEGORY_NAMES } from '../lib/categories';
import {
  OTHER_PROVIDER,
  PAYMENT_MODES,
  paymentProviders,
} from '../lib/payments';
import { scanBill } from '../lib/scan';
import { api } from '../lib/api';
import { useSettings, getSettingsSync } from '../lib/settings';
import type { Expense } from '../lib/types';
import { Button, Label } from '../components/ui';
import { DatePickerField } from '../components/DatePickerField';
import { Background } from '../components/Background';
import { colors, font, radius, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

const MODE_COLORS: Record<string, string> = {
  Cash: colors.green,
  UPI: colors.accent,
  Card: colors.primary2,
};

// Guarded haptic tap. On Android, Vibration.vibrate() throws (and crashes the
// app) if the VIBRATE permission is missing/denied, so never let it bubble up.
function tap(): void {
  try {
    Vibration.vibrate(15);
  } catch {
    /* haptics unavailable — ignore */
  }
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

type Props = NativeStackScreenProps<RootStackParamList, 'ExpenseForm'>;

export function ExpenseFormScreen({ route, navigation }: Props) {
  const editing: Expense | undefined = route.params?.expense;
  const { addExpense, editExpense, removeExpense } = useStore();
  const { currency } = useCurrency();
  const { settings } = useSettings();

  const [title, setTitle] = useState(editing?.title ?? '');
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [category, setCategory] = useState(editing?.category ?? 'Grocery');
  const [paidBy, setPaidBy] = useState(editing?.paidBy ?? getSettingsSync().defaultPayer);
  const [date, setDate] = useState(
    editing ? editing.date.slice(0, 10) : todayISO(),
  );
  const [paymentMode, setPaymentMode] = useState(editing?.paymentMode ?? '');
  const [provider, setProvider] = useState(editing?.paymentDetail ?? '');
  const [customProvider, setCustomProvider] = useState('');
  const [thumbnail, setThumbnail] = useState<string | null>(editing?.thumbnail ?? null);
  // Records a deliberate "remove bill" so we send "" (clear) instead of omitting
  // the field — which the server treats as "leave the stored bill unchanged".
  const [thumbCleared, setThumbCleared] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  // Full-screen preview of the (tiny) bill thumbnail — for scans and edits alike.
  const [viewer, setViewer] = useState(false);
  // Which fields the scan auto-filled — highlighted so the user knows what to
  // double-check. Cleared per-field as soon as they edit that field.
  const [hi, setHi] = useState<Record<string, boolean>>({});

  const clearHi = (k: string) => setHi(h => (h[k] ? { ...h, [k]: false } : h));

  // The list payload omits thumbnails to stay light. If we're editing a row the
  // server has a bill for but this phone hasn't cached the image (scanned on
  // another device), pull just that one thumbnail on demand.
  useEffect(() => {
    if (!editing || editing.thumbnail || !editing.hasThumbnail) return;
    let cancelled = false;
    (async () => {
      try {
        const { thumbnail: t } = await api.getThumbnail(editing.id);
        if (!cancelled && t) {
          setThumbnail(t);
          setThumbCleared(false);
        }
      } catch {
        /* offline / not found — keep showing the category icon */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing]);

  const providers = useMemo(
    () => paymentProviders(paymentMode, currency.code),
    [paymentMode, currency.code],
  );
  const usingCustom =
    !!paymentMode && provider === OTHER_PROVIDER;

  // Apply a scanned bill: prefill whatever we could read; the form itself is the
  // editable preview so the user fills the rest before saving.
  const runScan = async (src: 'camera' | 'library') => {
    setScanning(true);
    setError('');
    try {
      const result = await scanBill(src);
      if (!result) return; // user cancelled
      const p = result.parsed;
      const marks: Record<string, boolean> = {};

      if (p.title) {
        setTitle(p.title);
        marks.title = true;
      }
      if (p.amount != null) {
        setAmount(String(p.amount));
        marks.amount = true;
      }
      if (p.date) {
        setDate(p.date);
        marks.date = true;
      }
      if (p.category && CATEGORY_NAMES.includes(p.category)) {
        setCategory(p.category);
        marks.category = true;
      }
      if (p.paymentMode) {
        setPaymentMode(p.paymentMode);
        marks.payment = true;
        const list = paymentProviders(p.paymentMode, currency.code);
        const match = p.paymentDetail
          ? list.find(x => x.toLowerCase() === p.paymentDetail!.toLowerCase())
          : undefined;
        if (match) {
          setProvider(match);
        } else if (p.paymentDetail) {
          setProvider(OTHER_PROVIDER);
          setCustomProvider(p.paymentDetail);
        } else {
          setProvider('');
        }
      }
      setThumbnail(result.thumbnail);
      setHi(marks);

      const found = Object.keys(marks).length;
      setScanNote(
        found
          ? 'Bill fetched — auto-detected details can sometimes be wrong (especially the amount, which may pick a line item). Please review carefully, fix the highlighted fields, then add.'
          : 'Bill fetched, but we couldn’t read the details clearly — please enter them manually and review before adding.',
      );
    } catch (e) {
      Alert.alert('Scan failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setScanning(false);
    }
  };

  const submit = async () => {
    setError('');
    const amt = Number(amount);
    if (!title.trim()) return setError('What did you spend on?');
    if (!Number.isFinite(amt) || amt <= 0) return setError('Enter a valid amount.');
    if (!paidBy.trim()) return setError('Who paid?');
    if (!/[a-zA-Z]/.test(paidBy)) return setError('Paid by should include a name, not just numbers.');

    let finalDetail = '';
    if (paymentMode === 'UPI' || paymentMode === 'Card') {
      finalDetail = provider === OTHER_PROVIDER ? customProvider.trim() : provider;
    }

    setBusy(true);
    try {
      const draft = {
        title: title.trim(),
        category,
        amount: amt,
        paidBy: paidBy.trim(),
        date,
        paymentMode: paymentMode || undefined,
        paymentDetail: finalDetail || undefined,
        // Omit when unknown (leave the stored bill untouched); "" only when the
        // user explicitly removed it; the string when we have an image.
        thumbnail: thumbnail ? thumbnail : thumbCleared ? '' : undefined,
      };
      if (editing) await editExpense(editing.id, draft);
      else await addExpense(draft);
      if (settings.haptics) tap();
      navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!editing) return;
    setBusy(true);
    if (settings.haptics) tap();
    await removeExpense(editing.id);
    navigation.goBack();
  };

  const onDelete = () => {
    if (!editing) return;
    if (settings.confirmDelete) {
      Alert.alert('Delete expense', `Delete “${editing.title}”? This can't be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void doDelete() },
      ]);
      return;
    }
    void doDelete();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Background />
      <View style={styles.header}>
        <Text style={styles.hTitle}>{editing ? 'Edit expense' : 'Add expense'}</Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <X size={24} color={colors.textDim} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.scanRow}>
            <Pressable
              style={styles.scanBtn}
              onPress={() => runScan('camera')}
              disabled={scanning}>
              <Camera size={18} color={colors.primary} />
              <Text style={styles.scanText}>Scan a bill</Text>
            </Pressable>
            <Pressable
              style={styles.scanBtn}
              onPress={() => runScan('library')}
              disabled={scanning}>
              <Images size={18} color={colors.primary} />
              <Text style={styles.scanText}>Choose from Gallery</Text>
            </Pressable>
          </View>

          {((thumbnail && settings.showThumbnails) || scanNote) ? (
            <View style={styles.scanResult}>
              {thumbnail && settings.showThumbnails ? (
                <View style={styles.thumbWrap}>
                  <Pressable onPress={() => setViewer(true)}>
                    <Image source={{ uri: thumbnail }} style={styles.thumb} resizeMode="cover" />
                  </Pressable>
                  <Pressable
                    style={styles.thumbRemove}
                    hitSlop={8}
                    onPress={() => {
                      setThumbnail(null);
                      setThumbCleared(true);
                    }}>
                    <X size={14} color="#fff" />
                  </Pressable>
                </View>
              ) : null}
              <Text style={styles.scanNote}>
                {scanNote || 'Bill preview — tap the image to view it larger.'}
              </Text>
            </View>
          ) : null}

          <Label>What did you spend on?</Label>
          <TextInput
            value={title}
            onChangeText={t => { setTitle(t); clearHi('title'); }}
            placeholder="e.g. Paid for groceries, Online shopping at Amazon"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, hi.title && styles.inputHi]}
          />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Label>Amount ({currency.symbol})</Label>
              <TextInput
                value={amount}
                onChangeText={t => { setAmount(t); clearHi('amount'); }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, hi.amount && styles.inputHi]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Label>Date</Label>
              <View style={hi.date && styles.hiWrap}>
                <DatePickerField
                  value={date}
                  onChange={d => { setDate(d); clearHi('date'); }}
                />
              </View>
            </View>
          </View>

          <Label style={{ marginTop: spacing.md }}>Paid by</Label>
          <TextInput
            value={paidBy}
            onChangeText={setPaidBy}
            placeholder="Name of who paid"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <Label style={{ marginTop: spacing.md }}>Category</Label>
          <View style={[styles.wrap, hi.category && styles.hiWrap]}>
            {CATEGORIES.map(c => {
              const active = category === c.name;
              return (
                <Pressable
                  key={c.name}
                  onPress={() => { setCategory(c.name); clearHi('category'); }}
                  style={[
                    styles.catPill,
                    active && { backgroundColor: c.color + '33', borderColor: c.color },
                  ]}>
                  {/* Emoji and label in separate Text nodes: on Android an emoji +
                      Latin text in ONE Text can drop the trailing text (font
                      fallback bug) — this keeps the name always visible. */}
                  <Text style={styles.catEmoji}>{c.emoji}</Text>
                  <Text style={styles.catText}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <Label style={{ marginTop: spacing.md }}>Payment mode</Label>
          <View style={[styles.row, hi.payment && styles.hiWrap]}>
            {PAYMENT_MODES.map(m => {
              const active = paymentMode === m;
              const clr = MODE_COLORS[m];
              return (
                <Pressable
                  key={m}
                  onPress={() => {
                    setPaymentMode(active ? '' : m);
                    setProvider('');
                    setCustomProvider('');
                    clearHi('payment');
                  }}
                  style={[
                    styles.modeBtn,
                    active && {
                      backgroundColor: clr + '33',
                      borderColor: clr,
                    },
                  ]}>
                  <Text style={[styles.modeText, active && { color: colors.text, fontWeight: '800' }]}>
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {providers.length > 0 && (
            <View style={styles.wrap}>
              {[...providers, OTHER_PROVIDER].map(p => {
                const active = provider === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setProvider(p)}
                    style={[
                      styles.catPill,
                      active && { backgroundColor: colors.primary + '33', borderColor: colors.primary },
                    ]}>
                    <Text style={styles.catText}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {usingCustom && (
            <TextInput
              value={customProvider}
              onChangeText={setCustomProvider}
              placeholder="Enter provider name"
              placeholderTextColor={colors.textFaint}
              style={[styles.input, { marginTop: spacing.sm }]}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={editing ? 'Save changes' : 'Add expense'}
            onPress={submit}
            loading={busy}
            style={{ marginTop: spacing.lg }}
          />
          {editing ? (
            <Button label="Delete" variant="danger" onPress={onDelete} style={{ marginTop: spacing.sm }} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Tap-to-enlarge preview of the stored bill thumbnail. */}
      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewer(false)}>
          {thumbnail ? (
            <Image source={{ uri: thumbnail }} style={styles.viewerImg} resizeMode="contain" />
          ) : null}
          <View style={styles.viewerClose}>
            <X size={18} color="#fff" />
          </View>
          <Text style={styles.viewerHint}>Tap anywhere to close</Text>
        </Pressable>
      </Modal>

      {/* Loading overlay while OCR runs after capture/pick. */}
      <Modal visible={scanning} transparent animationType="fade">
        <View style={styles.loadingBackdrop}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Reading bill…</Text>
            <Text style={styles.loadingSub}>Extracting details on your device</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // (Background component fills behind; bg base prevents the modal being see-through)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hTitle: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  scanRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  scanBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
  },
  scanText: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  scanResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  thumbWrap: { position: 'relative' },
  thumb: {
    width: 54,
    height: 70,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanNote: { flex: 1, color: colors.textDim, fontSize: font.small, lineHeight: 18 },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    height: 50,
    color: colors.text,
    fontSize: font.body,
  },
  // Applied to fields the scan just filled, so the user knows what to verify.
  inputHi: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primary + '14' },
  hiWrap: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: 4,
    backgroundColor: colors.primary + '10',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  catEmoji: { fontSize: font.small },
  catText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeText: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  error: { color: colors.red, fontSize: font.small, marginTop: spacing.md },
  loadingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl * 1.5,
    alignItems: 'center',
    gap: spacing.sm,
  },
  loadingText: { color: colors.text, fontSize: font.body, fontWeight: '800', marginTop: spacing.sm },
  loadingSub: { color: colors.textDim, fontSize: font.small },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  // The thumbnail is a tiny ~10KB JPEG; it will look soft when enlarged — that's
  // expected since we deliberately never store the full-resolution photo.
  viewerImg: { width: '90%', height: '70%', borderRadius: radius.md },
  viewerClose: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHint: { position: 'absolute', bottom: spacing.xl, color: colors.textDim, fontSize: font.small },
});
