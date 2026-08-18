import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Activity as ActivityIcon,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Cpu,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Layers,
  LifeBuoy,
  MemoryStick,
  Paperclip,
  Receipt,
  ScanLine,
  Server,
  ShieldCheck,
  Tag,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react-native';
import { api } from '../lib/api';
import { colors, font, radius, spacing } from '../theme';

/* ---------- types (mirror the web admin) ---------- */

type Totals = {
  spaces: number;
  expenses: number;
  grandTotal: number;
  avgExpense: number;
  avgPerSpace: number;
};
type Storage = {
  dbBytes: number;
  expenseTableBytes: number;
  limitBytes: number | null;
  attachments: { count: number; totalBytes: number; avgBytes: number; maxBytes: number };
  tables: { name: string; bytes: number }[];
};
type Ocr = {
  configured: boolean;
  countTotal: number;
  countEngine1: number;
  countEngine2: number;
  countEngine3: number;
  monthlyLimit: number;
  engine3MonthlyLimit: number;
  dailyRateLimit: number;
};
type Space = {
  id: string;
  name: string;
  budget: number | null;
  createdAt: string;
  expenseCount: number;
  total: number;
  firstDate: string | null;
  lastDate: string | null;
  attachCount: number;
  attachMonths: number;
};
type Cat = { category: string; count: number; total: number };
type Payer = { payer: string; count: number; total: number };
type Paged<T> = { total: number; page: number; pageSize: number; items: T[] };
type Bucket = 'day' | 'week' | 'month' | 'year';
type ActivityData = {
  bucket: Bucket;
  series: { period: string; count: number; total: number }[];
  performance: { curCount: number; curTotal: number; prevCount: number; prevTotal: number };
  activeSpaces: { name: string; inputs: number; total: number }[];
};
type ResetItem = {
  id: string;
  status: string;
  spaceName: string;
  spaceCreated: string;
  requestedAt: string;
  resolvedAt: string | null;
  hasRecovery: boolean;
  expenseCount: number;
  total: number;
  budget: number | null;
  questionnaire: string;
  recent: { title: string; amount: number; payer: string; date: string }[];
  payers: string[];
  titles: string[];
  amounts: number[];
};
type Tab = 'spaces' | 'categories' | 'payers' | 'activity' | 'resets';
type Creds = { databaseUrl: string; authSecret: string };
type Overview = { totals: Totals };
type Meter = { usedBytes: number; totalBytes: number; usedPct: number };
type System = {
  cpu: { cores: number; load1: number; loadPct: number | null };
  memory: Meter & { basis: 'process' | 'host' };
  disk: Meter | null;
  uptimeSec: number;
  node: string;
  region: string | null;
};
type PanelKind = 'storage' | 'ocr' | 'system';

/* ---------- helpers ---------- */

const nf = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const nfmt = (n: number) => n.toLocaleString('en-IN');

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v.toLocaleString('en-IN', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pct(cur: number, prev: number): string {
  if (prev === 0) return cur > 0 ? '+100%' : '0%';
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
}

function parseEnvValue(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+?)\\s*$`, 'im');
  const m = text.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || null;
}

const PERIOD_LABEL: Record<Bucket, { cur: string; prev: string }> = {
  day: { cur: 'Today', prev: 'Yesterday' },
  week: { cur: 'This week', prev: 'Last week' },
  month: { cur: 'This month', prev: 'Last month' },
  year: { cur: 'This year', prev: 'Last year' },
};

const TABLE_LABEL: Record<string, string> = {
  Expense: 'Expenses',
  Ledger: 'Spaces (ledgers)',
  ResetRequest: 'Reset requests',
  _prisma_migrations: 'Prisma migrations',
};

const QLABELS: Record<string, string> = {
  approxCreated: 'Created around',
  recentExpense: 'A recent expense',
  recentAmount: 'A recent amount',
  payerName: 'A payer name',
  budget: 'Monthly budget',
  note: 'Extra note',
};

function numFrom(s: string): number | null {
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

type MatchVerdict = 'complete' | 'probable' | 'none' | 'na';
type MatchResult = { matched: number; total: number; verdict: MatchVerdict; perField: Record<string, boolean> };

function scoreMatch(answers: Record<string, string>, r: ResetItem): MatchResult {
  const perField: Record<string, boolean> = {};
  const created = r.spaceCreated ? new Date(r.spaceCreated) : null;
  const createdTokens = created
    ? [
        String(created.getFullYear()),
        created.toLocaleDateString('en-US', { month: 'long' }).toLowerCase(),
        created.toLocaleDateString('en-US', { month: 'short' }).toLowerCase(),
      ]
    : [];

  const check = (key: string, ok: boolean) => {
    perField[key] = ok;
  };

  for (const [key, raw] of Object.entries(answers)) {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v || key === 'note') continue;
    switch (key) {
      case 'approxCreated':
        check(key, createdTokens.some(t => t && v.includes(t)));
        break;
      case 'recentExpense':
        check(key, r.titles.some(t => t && (t.includes(v) || v.includes(t))));
        break;
      case 'recentAmount': {
        const n = numFrom(v);
        check(key, n !== null && r.amounts.some(a => Math.abs(a - n) < 0.01));
        break;
      }
      case 'payerName':
        check(key, r.payers.some(p => p && (p === v || p.includes(v) || v.includes(p))));
        break;
      case 'budget': {
        const n = numFrom(v);
        check(key, n !== null && r.budget !== null && Math.abs(r.budget - n) < 0.5);
        break;
      }
      default:
        break;
    }
  }

  const total = Object.keys(perField).length;
  const matched = Object.values(perField).filter(Boolean).length;
  let verdict: MatchVerdict;
  if (total === 0) verdict = 'na';
  else if (matched === total) verdict = 'complete';
  else if (matched > 0) verdict = 'probable';
  else verdict = 'none';
  return { matched, total, verdict, perField };
}

/* ---------- component ---------- */

export function AdminDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'fields' | 'paste'>('fields');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [authSecret, setAuthSecret] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creds, setCreds] = useState<Creds | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [ocr, setOcr] = useState<Ocr | null>(null);
  const [system, setSystem] = useState<System | null>(null);

  // Collapsible detail panels — closed by default. Data is fetched on expand and
  // cleared on collapse so nothing heavy lingers in device memory.
  const [openPanel, setOpenPanel] = useState<Record<PanelKind, boolean>>({
    storage: false,
    ocr: false,
    system: false,
  });
  const [panelLoading, setPanelLoading] = useState<Record<PanelKind, boolean>>({
    storage: false,
    ocr: false,
    system: false,
  });

  const [tab, setTab] = useState<Tab>('spaces');
  const [spaces, setSpaces] = useState<Paged<Space> | null>(null);
  const [categories, setCategories] = useState<Paged<Cat> | null>(null);
  const [payers, setPayers] = useState<Paged<Payer> | null>(null);
  const [bucket, setBucket] = useState<Bucket>('week');
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [resets, setResets] = useState<Paged<ResetItem> | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  // Wipe everything the moment the panel closes — nothing lingers on device.
  useEffect(() => {
    if (!open) {
      setMode('fields');
      setDatabaseUrl('');
      setAuthSecret('');
      setPasteText('');
      setShowSecrets(false);
      setError(null);
      setLoading(false);
      setCreds(null);
      setTotals(null);
      setStorage(null);
      setOcr(null);
      setSystem(null);
      setOpenPanel({ storage: false, ocr: false, system: false });
      setPanelLoading({ storage: false, ocr: false, system: false });
      setTab('spaces');
      setSpaces(null);
      setCategories(null);
      setPayers(null);
      setBucket('week');
      setActivity(null);
      setResets(null);
      setTabLoading(false);
      setTabError(null);
    }
  }, [open]);

  async function unlock() {
    let dbUrl = databaseUrl;
    let secret = authSecret;
    if (mode === 'paste') {
      const pd = parseEnvValue(pasteText, 'DATABASE_URL');
      const ps = parseEnvValue(pasteText, 'AUTH_SECRET');
      if (!pd || !ps) {
        setError(
          `Couldn't find ${!pd ? 'DATABASE_URL' : ''}${!pd && !ps ? ' and ' : ''}${
            !ps ? 'AUTH_SECRET' : ''
          } in the pasted text.`,
        );
        return;
      }
      dbUrl = pd;
      secret = ps;
    }
    if (!dbUrl.trim() || !secret.trim()) {
      setError('Enter both DATABASE_URL and AUTH_SECRET.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const c: Creds = { databaseUrl: dbUrl.trim(), authSecret: secret.trim() };
      // Light unlock: only the cheap totals. The storage / OCR / host panels stay
      // collapsed and each fetches its own slice on expand, so unlocking is fast
      // and the screen stays light on the phone.
      const ov = await api.adminSection<Overview>(c, 'overview', { light: true });
      setTotals(ov.totals);
      setCreds(c);
      setTab('spaces');
      const sp = await api.adminSection<Paged<Space>>(c, 'spaces', { page: 0 });
      setSpaces(sp);
      setDatabaseUrl('');
      setAuthSecret('');
      setPasteText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function load(c: Creds, t: Tab, opts: { page?: number; bucket?: Bucket } = {}) {
    setTabLoading(true);
    setTabError(null);
    try {
      if (t === 'spaces') setSpaces(await api.adminSection<Paged<Space>>(c, 'spaces', { page: opts.page ?? 0 }));
      else if (t === 'categories') setCategories(await api.adminSection<Paged<Cat>>(c, 'categories', { page: opts.page ?? 0 }));
      else if (t === 'payers') setPayers(await api.adminSection<Paged<Payer>>(c, 'payers', { page: opts.page ?? 0 }));
      else if (t === 'activity') setActivity(await api.adminSection<ActivityData>(c, 'activity', { bucket: opts.bucket ?? bucket }));
      else if (t === 'resets') setResets(await api.adminSection<Paged<ResetItem>>(c, 'resets', { page: opts.page ?? 0 }));
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setTabLoading(false);
    }
  }

  // Expand/collapse a detail panel. Expanding fetches only that panel's slice;
  // collapsing clears its data so nothing heavy sits in memory (re-expanding
  // refetches). Keeps the admin screen light on the phone.
  async function togglePanel(kind: PanelKind) {
    if (openPanel[kind]) {
      setOpenPanel(p => ({ ...p, [kind]: false }));
      if (kind === 'storage') setStorage(null);
      else if (kind === 'ocr') setOcr(null);
      else setSystem(null);
      return;
    }

    setOpenPanel(p => ({ ...p, [kind]: true }));
    if (!creds) return;
    setPanelLoading(p => ({ ...p, [kind]: true }));
    try {
      if (kind === 'storage') {
        const d = await api.adminSection<{ storage: Storage | null }>(creds, 'storage');
        setStorage(d.storage ?? null);
      } else if (kind === 'ocr') {
        const d = await api.adminSection<{ ocr: Ocr | null }>(creds, 'ocr');
        setOcr(d.ocr ?? null);
      } else {
        const d = await api.adminSection<{ system: System | null }>(creds, 'system');
        setSystem(d.system ?? null);
      }
    } catch {
      // Leave the panel open but empty; a re-toggle retries.
    } finally {
      setPanelLoading(p => ({ ...p, [kind]: false }));
    }
  }

  async function resetAction(id: string, action: 'approve' | 'reject') {
    if (!creds) return;
    setTabLoading(true);
    setTabError(null);
    try {
      await api.adminReset(creds, id, action);
      await load(creds, 'resets', { page: resets?.page ?? 0 });
    } catch (e) {
      setTabError(e instanceof Error ? e.message : 'Action failed.');
      setTabLoading(false);
    }
  }

  function openTab(t: Tab) {
    setTab(t);
    setTabError(null);
    if (!creds) return;
    if (t === 'spaces' && !spaces) void load(creds, 'spaces', { page: 0 });
    else if (t === 'categories' && !categories) void load(creds, 'categories', { page: 0 });
    else if (t === 'payers' && !payers) void load(creds, 'payers', { page: 0 });
    else if (t === 'activity' && !activity) void load(creds, 'activity', { bucket });
    else if (t === 'resets' && !resets) void load(creds, 'resets', { page: 0 });
  }

  function changeBucket(b: Bucket) {
    setBucket(b);
    if (creds) void load(creds, 'activity', { bucket: b });
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* header */}
          <View style={styles.header}>
            <View style={styles.headLeft}>
              <View style={styles.headIcon}>
                <ShieldCheck size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.headTitle}>Admin dashboard</Text>
                <Text style={styles.headSub}>{creds ? 'Database overview' : 'Owner access only'}</Text>
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>

          {!creds ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.gateNote}>
                Provide your DATABASE_URL and AUTH_SECRET to unlock a read-only overview. They're
                verified over HTTPS and kept only in memory for this session — never saved to disk.
              </Text>

              <View style={styles.segment}>
                <SegBtn label="Enter fields" active={mode === 'fields'} onPress={() => { setMode('fields'); setError(null); }} />
                <SegBtn label="Paste .env" active={mode === 'paste'} onPress={() => { setMode('paste'); setError(null); }} />
              </View>

              {mode === 'fields' ? (
                <>
                  <FieldLabel icon={<Database size={13} color={colors.textDim} />} text="DATABASE_URL" />
                  <TextInput
                    value={databaseUrl}
                    onChangeText={setDatabaseUrl}
                    placeholder="postgresql://…"
                    placeholderTextColor={colors.textFaint}
                    secureTextEntry={!showSecrets}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.mono]}
                  />
                  <FieldLabel icon={<KeyRound size={13} color={colors.textDim} />} text="AUTH_SECRET" />
                  <TextInput
                    value={authSecret}
                    onChangeText={setAuthSecret}
                    placeholder="••••••••••••••••"
                    placeholderTextColor={colors.textFaint}
                    secureTextEntry={!showSecrets}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.mono]}
                  />
                </>
              ) : (
                <>
                  <FieldLabel text="Paste your .env (both variables)" />
                  <TextInput
                    value={pasteText}
                    onChangeText={setPasteText}
                    placeholder={'DATABASE_URL="postgresql://user:pass@host/db"\nAUTH_SECRET="your-secret"'}
                    placeholderTextColor={colors.textFaint}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.mono, styles.textarea]}
                  />
                  <Text style={styles.hintTiny}>Extra lines are ignored — only DATABASE_URL and AUTH_SECRET are read.</Text>
                </>
              )}

              <Pressable onPress={() => setShowSecrets(s => !s)} hitSlop={8} style={styles.showToggle}>
                {showSecrets ? <EyeOff size={14} color={colors.textDim} /> : <Eye size={14} color={colors.textDim} />}
                <Text style={styles.showToggleText}>{showSecrets ? 'Hide' : 'Show'} values</Text>
              </Pressable>

              {error ? <ErrorBox msg={error} /> : null}

              <Pressable
                onPress={unlock}
                disabled={loading}
                android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                style={({ pressed }) => [styles.primaryBtn, (loading || pressed) && { opacity: 0.7 }]}>
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <ShieldCheck size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Unlock dashboard</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {/* summary cards */}
              <View style={styles.statGrid}>
                <StatCard icon={<Layers size={14} color={colors.accent} />} label="Spaces" value={totals ? String(totals.spaces) : '—'} />
                <StatCard icon={<Receipt size={14} color={colors.green} />} label="Expenses" value={totals ? String(totals.expenses) : '—'} />
                <StatCard icon={<Coins size={14} color={colors.amber} />} label="Grand total" value={totals ? nf(totals.grandTotal) : '—'} />
                <StatCard icon={<TrendingUp size={14} color={colors.primary2} />} label="Avg / expense" value={totals ? nf(totals.avgExpense) : '—'} />
              </View>
              <Text style={styles.hintTiny}>
                Amounts are currency-agnostic — currency is a per-device display setting and isn't stored.
              </Text>

              {/* Detail panels — collapsed by default, each loads on expand and
                  clears on collapse to keep the screen light. */}
              <View style={{ gap: spacing.xs }}>
                <CollapseCard
                  icon={<HardDrive size={13} color={colors.textDim} />}
                  title="Database storage"
                  open={openPanel.storage}
                  loading={panelLoading.storage}
                  onToggle={() => togglePanel('storage')}
                >
                  {storage ? <StoragePanel s={storage} /> : null}
                </CollapseCard>

                <CollapseCard
                  icon={<ScanLine size={13} color={colors.accent} />}
                  title="Bill scanning (OCR.space)"
                  open={openPanel.ocr}
                  loading={panelLoading.ocr}
                  onToggle={() => togglePanel('ocr')}
                >
                  {ocr ? <OcrPanel o={ocr} /> : null}
                </CollapseCard>

                <CollapseCard
                  icon={<Server size={13} color={colors.textDim} />}
                  title="Host runtime (CPU / memory / disk)"
                  open={openPanel.system}
                  loading={panelLoading.system}
                  onToggle={() => togglePanel('system')}
                >
                  {system ? <HostPanel s={system} /> : null}
                </CollapseCard>
              </View>

              {/* tab bar */}
              <View style={styles.tabBar}>
                <TabBtn active={tab === 'spaces'} onPress={() => openTab('spaces')} icon={<Layers size={14} color={tab === 'spaces' ? colors.text : colors.textDim} />} label="Spaces" />
                <TabBtn active={tab === 'categories'} onPress={() => openTab('categories')} icon={<Tag size={14} color={tab === 'categories' ? colors.text : colors.textDim} />} label="Cats" />
                <TabBtn active={tab === 'payers'} onPress={() => openTab('payers')} icon={<Users size={14} color={tab === 'payers' ? colors.text : colors.textDim} />} label="Payers" />
                <TabBtn active={tab === 'activity'} onPress={() => openTab('activity')} icon={<ActivityIcon size={14} color={tab === 'activity' ? colors.text : colors.textDim} />} label="Activity" />
                <TabBtn active={tab === 'resets'} onPress={() => openTab('resets')} icon={<LifeBuoy size={14} color={tab === 'resets' ? colors.text : colors.textDim} />} label="Resets" />
              </View>

              {/* tab content */}
              <View style={{ minHeight: 160 }}>
                {tabLoading ? (
                  <View style={styles.tabLoading}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : tabError ? (
                  <ErrorBox msg={tabError} />
                ) : tab === 'spaces' ? (
                  <SpacesTab data={spaces} onPage={p => creds && load(creds, 'spaces', { page: p })} />
                ) : tab === 'categories' ? (
                  <CategoriesTab data={categories} onPage={p => creds && load(creds, 'categories', { page: p })} />
                ) : tab === 'payers' ? (
                  <PayersTab data={payers} onPage={p => creds && load(creds, 'payers', { page: p })} />
                ) : tab === 'activity' ? (
                  <ActivityTab data={activity} bucket={bucket} onBucket={changeBucket} />
                ) : (
                  <ResetsTab data={resets} onPage={p => creds && load(creds, 'resets', { page: p })} onAction={resetAction} />
                )}
              </View>

              <Pressable onPress={onClose} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- sub views ---------- */

function SegBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segBtn, active && styles.segBtnActive]}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FieldLabel({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return (
    <View style={styles.fieldLabelRow}>
      {icon}
      <Text style={styles.fieldLabel}>{text}</Text>
    </View>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Bar({ ratio, colorA }: { ratio: number; colorA: string }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, ratio * 100))}%`, backgroundColor: colorA }]} />
    </View>
  );
}

function StoragePanel({ s }: { s: Storage }) {
  const used = s.dbBytes;
  const limit = s.limitBytes;
  const usedPct = limit ? Math.min(100, (used / limit) * 100) : null;
  const attachPct = s.dbBytes > 0 ? Math.min(100, (s.attachments.totalBytes / s.dbBytes) * 100) : 0;

  const rows = useMemo(() => {
    const appTotal = s.tables.reduce((a, t) => a + t.bytes, 0);
    const other = Math.max(0, s.dbBytes - appTotal);
    const list = s.tables
      .filter(t => t.bytes > 0)
      .map(t => ({ name: TABLE_LABEL[t.name] ?? t.name, bytes: t.bytes }));
    if (other > 0) list.push({ name: 'System & catalogs', bytes: other });
    list.sort((a, b) => b.bytes - a.bytes);
    return list;
  }, [s]);
  const max = Math.max(1, ...rows.map(r => r.bytes));

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <HardDrive size={13} color={colors.textDim} />
          <Text style={styles.cardHeadText}>Database storage</Text>
        </View>
        <Text style={styles.bigNum}>
          {fmtBytes(used)}
          {limit ? <Text style={styles.bigNumSub}> / {fmtBytes(limit)}</Text> : null}
        </Text>
        {usedPct !== null ? (
          <>
            <Bar ratio={usedPct / 100} colorA={usedPct > 90 ? colors.red : colors.primary} />
            <Text style={styles.tinyDim}>{fmtBytes(Math.max(0, limit! - used))} left · {usedPct.toFixed(0)}% used</Text>
          </>
        ) : (
          <Text style={styles.tinyDim}>
            No plan cap set. Set ADMIN_STORAGE_LIMIT_MB to track remaining space.
          </Text>
        )}
        <Text style={styles.tinyFaint}>Expense table: {fmtBytes(s.expenseTableBytes)}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Paperclip size={13} color={colors.textDim} />
          <Text style={styles.cardHeadText}>Bill attachments</Text>
        </View>
        <Text style={styles.bigNum}>
          {fmtBytes(s.attachments.totalBytes)}
          <Text style={styles.bigNumSub}> · {s.attachments.count} thumbs</Text>
        </Text>
        <Bar ratio={attachPct / 100} colorA={colors.green} />
        <Text style={styles.tinyDim}>{attachPct.toFixed(1)}% of the database</Text>
        <Text style={styles.tinyFaint}>Avg {fmtBytes(s.attachments.avgBytes)} · Largest {fmtBytes(s.attachments.maxBytes)}</Text>
      </View>

      {rows.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardHeadText}>Where the {fmtBytes(s.dbBytes)} goes</Text>
          <View style={{ gap: 10, marginTop: spacing.sm }}>
            {rows.map(r => {
              const shareOfDb = s.dbBytes > 0 ? (r.bytes / s.dbBytes) * 100 : 0;
              const isOther = r.name === 'System & catalogs';
              return (
                <View key={r.name}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowLabel}>{r.name}</Text>
                    <Text style={styles.rowValue}>{fmtBytes(r.bytes)} · {shareOfDb.toFixed(shareOfDb < 1 ? 1 : 0)}%</Text>
                  </View>
                  <Bar ratio={r.bytes / max} colorA={isOther ? 'rgba(255,255,255,0.35)' : colors.primary} />
                </View>
              );
            })}
          </View>
          <Text style={styles.tinyFaint}>
            A fresh Postgres DB uses several MB for system catalogs and WAL even with little data — so
            most of a small DB is baseline overhead, not your rows.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function OcrPanel({ o }: { o: Ocr }) {
  const usedMonthly = o.countEngine1 + o.countEngine2;
  const leftMonthly = Math.max(0, o.monthlyLimit - usedMonthly);
  const usedPct = o.monthlyLimit > 0 ? Math.min(100, (usedMonthly / o.monthlyLimit) * 100) : 0;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <ScanLine size={13} color={colors.accent} />
        <Text style={styles.cardHeadText}>Bill scanning (OCR.space)</Text>
      </View>
      {!o.configured ? (
        <Text style={styles.tinyDim}>
          No OCRSPACE_API_KEY set — web scanning falls back to slower on-device OCR. Add the key to
          enable accurate scanning and quota tracking.
        </Text>
      ) : (
        <>
          <Text style={styles.bigNum}>
            {nfmt(leftMonthly)}
            <Text style={styles.bigNumSub}> scans left this month</Text>
          </Text>
          <Bar ratio={usedPct / 100} colorA={usedPct > 90 ? colors.red : colors.primary} />
          <Text style={styles.tinyDim}>{nfmt(usedMonthly)} / {nfmt(o.monthlyLimit)} used · {usedPct.toFixed(1)}%</Text>
          <Text style={styles.tinyFaint}>
            Rate limit: {nfmt(o.dailyRateLimit)} scans/day per IP. No hourly cap.
            {o.countEngine3 > 0 ? ` · Engine 3: ${nfmt(o.countEngine3)} / ${nfmt(o.engine3MonthlyLimit)}` : ''}
          </Text>
        </>
      )}
    </View>
  );
}

/* ---------- collapsible detail panels ---------- */

function CollapseCard({
  icon,
  title,
  open,
  loading,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  loading: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.collapseCard}>
      <Pressable onPress={onToggle} style={styles.collapseHead}>
        <View style={styles.collapseHeadLeft}>
          {icon}
          <Text style={styles.cardHeadText}>{title}</Text>
        </View>
        <View style={styles.collapseHeadRight}>
          {loading ? <ActivityIndicator size="small" color={colors.textDim} /> : null}
          <ChevronDown
            size={18}
            color={colors.textDim}
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.collapseBody}>
          {children ? (
            children
          ) : (
            <View style={styles.collapseLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- host runtime (CPU / memory / disk) ---------- */

function meterColor(pct: number): string {
  if (pct >= 90) return colors.red;
  if (pct >= 75) return colors.amber;
  return colors.primary;
}

function meterTextColor(pct: number): string {
  if (pct >= 90) return colors.red;
  if (pct >= 75) return colors.amber;
  return colors.textDim;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function MeterCard({
  icon,
  label,
  used,
  total,
  pct,
}: {
  icon: React.ReactNode;
  label: string;
  used: number;
  total: number;
  pct: number;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        {icon}
        <Text style={styles.cardHeadText}>{label}</Text>
      </View>
      <Text style={styles.bigNum}>
        {fmtBytes(used)}
        <Text style={styles.bigNumSub}> / {fmtBytes(total)}</Text>
      </Text>
      <Bar ratio={pct / 100} colorA={meterColor(pct)} />
      <Text style={[styles.tinyDim, { color: meterTextColor(pct) }]}>
        {pct >= 90 ? 'Almost full — ' : pct >= 75 ? 'Filling up — ' : ''}
        {fmtBytes(Math.max(0, total - used))} free · {pct.toFixed(0)}% used
      </Text>
    </View>
  );
}

function HostPanel({ s }: { s: System }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {s.region ? (
        <Text style={styles.tinyFaint}>Region: {s.region}</Text>
      ) : null}

      <MeterCard
        icon={<MemoryStick size={13} color={colors.textDim} />}
        label={s.memory.basis === 'process' ? 'Function memory' : 'Host memory'}
        used={s.memory.usedBytes}
        total={s.memory.totalBytes}
        pct={s.memory.usedPct}
      />

      {s.disk ? (
        <MeterCard
          icon={<HardDrive size={13} color={colors.textDim} />}
          label="Disk"
          used={s.disk.usedBytes}
          total={s.disk.totalBytes}
          pct={s.disk.usedPct}
        />
      ) : (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <HardDrive size={13} color={colors.textDim} />
            <Text style={styles.cardHeadText}>Disk</Text>
          </View>
          <Text style={styles.bigNum}>n/a</Text>
          <Text style={styles.tinyFaint}>Not reported on this runtime.</Text>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Cpu size={13} color={colors.textDim} />
          <Text style={styles.cardHeadText}>CPU load</Text>
        </View>
        <Text style={styles.bigNum}>
          {s.cpu.loadPct !== null ? `${s.cpu.loadPct.toFixed(0)}%` : 'n/a'}
          <Text style={styles.bigNumSub}>
            {' '}
            · {s.cpu.cores} {s.cpu.cores === 1 ? 'core' : 'cores'}
          </Text>
        </Text>
        {s.cpu.loadPct !== null ? (
          <>
            <Bar ratio={s.cpu.loadPct / 100} colorA={meterColor(s.cpu.loadPct)} />
            <Text style={[styles.tinyDim, { color: meterTextColor(s.cpu.loadPct) }]}>
              load {s.cpu.load1.toFixed(2)} across {s.cpu.cores}
            </Text>
          </>
        ) : (
          <Text style={styles.tinyDim}>Load average isn't exposed on serverless runtimes.</Text>
        )}
      </View>

      <Text style={styles.tinyFaint}>
        Read live at request time · uptime {fmtUptime(s.uptimeSec)} · Node {s.node}
        {s.memory.basis === 'process' ? ' · serverless instance — resets when it recycles' : ''}
      </Text>
    </View>
  );
}

function TabBtn({ active, onPress, icon, label }: { active: boolean; onPress: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      {icon}
      <Text style={[styles.tabBtnText, active && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <View style={styles.pager}>
      <Pressable onPress={() => onPage(page - 1)} disabled={page === 0} style={[styles.pagerBtn, page === 0 && { opacity: 0.4 }]}>
        <ChevronLeft size={16} color={colors.text} />
      </Pressable>
      <Text style={styles.pagerText}>Page {page + 1} of {totalPages}</Text>
      <Pressable onPress={() => onPage(page + 1)} disabled={page >= totalPages - 1} style={[styles.pagerBtn, page >= totalPages - 1 && { opacity: 0.4 }]}>
        <ChevronRight size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

function attachPerMonth(s: Space): number {
  if (!s.attachCount) return 0;
  const months = s.attachMonths > 0 ? s.attachMonths : 1;
  return s.attachCount / months;
}

function SpacesTab({ data, onPage }: { data: Paged<Space> | null; onPage: (p: number) => void }) {
  if (!data) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {data.items.map(s => {
        const perMo = attachPerMonth(s);
        return (
          <View key={s.id} style={styles.spaceCard}>
            <Text style={styles.spaceName}>{s.name}</Text>
            <View style={styles.kvGrid}>
              <KV label="Expenses" value={String(s.expenseCount)} />
              <KV label="Total" value={nf(s.total)} />
              <KV
                label="Bills"
                value={s.attachCount > 0 ? String(s.attachCount) : '—'}
                icon={s.attachCount > 0 ? <Paperclip size={11} color={colors.accent} /> : undefined}
              />
              <KV label="Bills/mo" value={perMo > 0 ? perMo.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : '—'} />
            </View>
            <Text style={styles.spaceMeta}>Created {fmtDate(s.createdAt)}</Text>
            <Text style={styles.spaceMeta}>
              {s.firstDate ? `Activity ${fmtDate(s.firstDate)} → ${fmtDate(s.lastDate)}` : 'No activity'}
            </Text>
          </View>
        );
      })}
      <Text style={styles.tinyFaint}>
        Bills = expenses with a scanned thumbnail. Bills/mo is the average uploads per month across the
        months a space has attachments.
      </Text>
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </View>
  );
}

function KV({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <View style={styles.kvValueRow}>
        {icon}
        <Text style={styles.kvValue}>{value}</Text>
      </View>
    </View>
  );
}

function CategoriesTab({ data, onPage }: { data: Paged<Cat> | null; onPage: (p: number) => void }) {
  const max = useMemo(() => Math.max(1, ...(data?.items.map(c => c.total) ?? [1])), [data]);
  if (!data) return null;
  return (
    <View style={{ gap: 10 }}>
      {data.items.map(c => (
        <View key={c.category}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>{c.category}</Text>
            <Text style={styles.rowValue}>{nf(c.total)} · {c.count}×</Text>
          </View>
          <Bar ratio={c.total / max} colorA={colors.primary} />
        </View>
      ))}
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </View>
  );
}

function PayersTab({ data, onPage }: { data: Paged<Payer> | null; onPage: (p: number) => void }) {
  if (!data) return null;
  return (
    <View style={{ gap: 6 }}>
      {data.items.map((p, i) => (
        <View key={p.payer + i} style={styles.payerRow}>
          <Text style={styles.payerName} numberOfLines={1}>{p.payer}</Text>
          <Text style={styles.rowValue}>{nf(p.total)} · {p.count}×</Text>
        </View>
      ))}
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </View>
  );
}

function ActivityTab({ data, bucket, onBucket }: { data: ActivityData | null; bucket: Bucket; onBucket: (b: Bucket) => void }) {
  const max = useMemo(() => Math.max(1, ...(data?.series.map(s => s.count) ?? [1])), [data]);
  const activeMax = useMemo(() => Math.max(1, ...(data?.activeSpaces.map(s => s.inputs) ?? [1])), [data]);
  const buckets: Bucket[] = ['day', 'week', 'month', 'year'];
  const bucketLabel = (b: Bucket) => (b === 'day' ? 'Daily' : b === 'week' ? 'Weekly' : b === 'month' ? 'Monthly' : 'Yearly');

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.segment}>
        {buckets.map(b => (
          <SegBtn key={b} label={bucketLabel(b)} active={bucket === b} onPress={() => onBucket(b)} />
        ))}
      </View>

      {!data ? (
        <Text style={styles.emptyNote}>Pick a period above to compute usage.</Text>
      ) : (
        <>
          <View style={styles.perfGrid}>
            <PerfCard label={PERIOD_LABEL[bucket].cur} count={data.performance.curCount} total={data.performance.curTotal} />
            <PerfCard label={PERIOD_LABEL[bucket].prev} count={data.performance.prevCount} total={data.performance.prevTotal} muted />
            <DeltaCard cur={data.performance.curCount} prev={data.performance.prevCount} />
          </View>

          <View>
            <Text style={styles.sectionTitle}>Inputs over time</Text>
            {data.series.length === 0 ? (
              <Text style={styles.emptyNote}>No activity in this window.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barsRow}>
                {data.series.map((s, i) => (
                  <View key={s.period + i} style={styles.barCol}>
                    <Text style={styles.barCount}>{s.count}</Text>
                    <View style={[styles.vBar, { height: Math.max(6, (s.count / max) * 110) }]} />
                    <Text style={styles.barPeriod}>{s.period}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <View>
            <Text style={styles.sectionTitle}>Most active spaces</Text>
            {data.activeSpaces.length === 0 ? (
              <Text style={styles.emptyNote}>No activity in this window.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {data.activeSpaces.map(s => (
                  <View key={s.name}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.rowLabel}>{s.name}</Text>
                      <Text style={styles.rowValue}>{s.inputs} input{s.inputs === 1 ? '' : 's'} · {nf(s.total)}</Text>
                    </View>
                    <Bar ratio={s.inputs / activeMax} colorA={colors.amber} />
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function PerfCard({ label, count, total, muted }: { label: string; count: number; total: number; muted?: boolean }) {
  return (
    <View style={[styles.perfCard, muted && { backgroundColor: 'rgba(255,255,255,0.03)' }]}>
      <Text style={styles.perfLabel}>{label}</Text>
      <Text style={styles.perfCount}>{count} <Text style={styles.perfCountSub}>inputs</Text></Text>
      <Text style={styles.perfTotal}>{nf(total)}</Text>
    </View>
  );
}

function DeltaCard({ cur, prev }: { cur: number; prev: number }) {
  const up = cur >= prev;
  return (
    <View style={styles.perfCard}>
      <Text style={styles.perfLabel}>Change</Text>
      <View style={styles.deltaRow}>
        {up ? <TrendingUp size={16} color={colors.green} /> : <TrendingDown size={16} color="#ff8787" />}
        <Text style={[styles.deltaText, { color: up ? colors.green : '#ff8787' }]}>{pct(cur, prev)}</Text>
      </View>
      <Text style={styles.perfTotal}>vs previous</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; border: string; color: string; label: string; icon: React.ReactNode }> = {
    pending: { bg: colors.amber + '1a', border: colors.amber + '4d', color: '#ffe08a', label: 'Pending', icon: <Clock size={11} color="#ffe08a" /> },
    approved: { bg: colors.green + '1a', border: colors.green + '4d', color: '#7be7c4', label: 'Approved', icon: <CheckCircle2 size={11} color="#7be7c4" /> },
    rejected: { bg: colors.red + '1a', border: colors.red + '4d', color: '#ffb3b3', label: 'Rejected', icon: <XCircle size={11} color="#ffb3b3" /> },
  };
  const s = map[status] ?? map.pending;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.border }]}>
      {s.icon}
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

function MatchBadge({ m }: { m: MatchResult }) {
  const map: Record<MatchVerdict, { bg: string; border: string; color: string; label: string }> = {
    complete: { bg: colors.green + '1a', border: colors.green + '4d', color: '#7be7c4', label: 'Complete match' },
    probable: { bg: colors.amber + '1a', border: colors.amber + '4d', color: '#ffe08a', label: 'Probable match' },
    none: { bg: colors.red + '1a', border: colors.red + '4d', color: '#ffb3b3', label: 'No match' },
    na: { bg: colors.surface, border: colors.border, color: colors.textDim, label: 'Unverifiable' },
  };
  const s = map[m.verdict];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg, borderColor: s.border }]}>
      <Text style={[styles.badgeText, { color: s.color }]}>
        {s.label}{m.total > 0 ? ` · ${m.matched}/${m.total}` : ''}
      </Text>
    </View>
  );
}

function ResetsTab({
  data,
  onPage,
  onAction,
}: {
  data: Paged<ResetItem> | null;
  onPage: (p: number) => void;
  onAction: (id: string, action: 'approve' | 'reject') => void;
}) {
  if (!data) return null;
  if (data.items.length === 0) return <Text style={styles.emptyNote}>No reset requests.</Text>;
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.tinyFaint}>
        Cross-check the owner's answers against the space's real data before approving. Approving
        activates the new passphrase the owner already chose.
      </Text>
      {data.items.map(r => (
        <ResetCard key={r.id} r={r} onAction={onAction} />
      ))}
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} onPage={onPage} />
    </View>
  );
}

function ResetCard({ r, onAction }: { r: ResetItem; onAction: (id: string, action: 'approve' | 'reject') => void }) {
  const isPending = r.status === 'pending';
  const [open, setOpen] = useState(isPending);

  let answers: Record<string, string> = {};
  try {
    answers = JSON.parse(r.questionnaire);
  } catch {
    /* ignore malformed */
  }
  const answered = Object.entries(answers).filter(([, v]) => v && String(v).trim());
  const match = scoreMatch(answers, r);

  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.resetHead}>
        <View style={styles.resetHeadLeft}>
          <Text style={styles.spaceName}>{r.spaceName}</Text>
          <View style={styles.badgeRow}>
            <StatusBadge status={r.status} />
            <MatchBadge m={match} />
          </View>
        </View>
        <View style={styles.resetHeadRight}>
          <Text style={styles.tinyFaint}>{fmtDate(r.requestedAt)}</Text>
          <ChevronDown size={16} color={colors.textDim} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
        </View>
      </Pressable>

      {open ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {/* owner's answers */}
          <View style={styles.subCard}>
            <Text style={styles.subCardTitle}>Owner's answers</Text>
            {answered.length ? (
              answered.map(([k, v]) => {
                const scored = k in match.perField;
                const ok = match.perField[k];
                return (
                  <View key={k} style={styles.rowBetween}>
                    <View style={styles.answerLabelRow}>
                      {scored ? (ok ? <CheckCircle2 size={11} color="#7be7c4" /> : <XCircle size={11} color="#ffb3b3" />) : null}
                      <Text style={styles.rowLabel}>{QLABELS[k] ?? k}</Text>
                    </View>
                    <Text style={styles.answerValue}>{v}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={styles.tinyDim}>No answers provided.</Text>
            )}
          </View>

          {/* real data */}
          <View style={styles.subCard}>
            <Text style={styles.subCardTitle}>Real data (verify)</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Created</Text>
              <Text style={styles.answerValue}>{fmtDate(r.spaceCreated)}</Text>
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Expenses</Text>
              <Text style={styles.answerValue}>{r.expenseCount} · {nf(r.total)}</Text>
            </View>
            {r.budget !== null ? (
              <View style={styles.rowBetween}>
                <Text style={styles.rowLabel}>Monthly budget</Text>
                <Text style={styles.answerValue}>{nf(r.budget)}</Text>
              </View>
            ) : null}
            {r.recent.length > 0 ? (
              <View style={styles.recentBox}>
                <Text style={styles.recentTitle}>Recent entries</Text>
                {r.recent.map((e, i) => (
                  <View key={i} style={styles.rowBetween}>
                    <Text style={styles.recentEntry} numberOfLines={1}>{e.title} · {e.payer}</Text>
                    <Text style={styles.recentAmount}>{nf(e.amount)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {r.hasRecovery && isPending ? (
            <Text style={styles.tinyFaint}>
              Note: this space has a recovery code set — the owner could reset it themselves with it.
            </Text>
          ) : null}

          {isPending ? (
            <View style={styles.resetActions}>
              <Pressable onPress={() => onAction(r.id, 'approve')} style={[styles.primaryBtn, { flex: 1 }]}>
                <CheckCircle2 size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Approve</Text>
              </Pressable>
              <Pressable onPress={() => onAction(r.id, 'reject')} style={[styles.ghostBtn, { flex: 1 }]}>
                <XCircle size={16} color="#ffb3b3" />
                <Text style={[styles.ghostBtnText, { color: '#ffb3b3' }]}>Reject</Text>
              </Pressable>
            </View>
          ) : r.resolvedAt ? (
            <Text style={styles.tinyFaint}>Resolved {fmtDate(r.resolvedAt)}</Text>
          ) : null}
        </View>
      ) : r.resolvedAt ? (
        <Text style={[styles.tinyFaint, { marginTop: 6 }]}>Resolved {fmtDate(r.resolvedAt)}</Text>
      ) : null}
    </View>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <Text style={styles.errorBox}>{msg}</Text>;
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    backgroundColor: '#141426',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.sheen,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.primary + '55', alignItems: 'center', justifyContent: 'center',
  },
  headTitle: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  headSub: { color: colors.textFaint, fontSize: font.tiny },
  closeBtn: {
    width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  body: { gap: spacing.md, paddingBottom: spacing.xl },

  gateNote: {
    color: colors.textDim, fontSize: font.small, lineHeight: 19,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  segment: {
    flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segBtnActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  segText: { color: colors.textDim, fontSize: font.small, fontWeight: '700' },
  segTextActive: { color: colors.text },

  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldLabel: { color: colors.textDim, fontSize: font.tiny, fontWeight: '600' },
  input: {
    backgroundColor: colors.bgElevated, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 46, color: colors.text, fontSize: font.small,
  },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  textarea: { height: 110, paddingTop: spacing.sm, textAlignVertical: 'top' },
  hintTiny: { color: colors.textFaint, fontSize: font.tiny, lineHeight: 15 },
  showToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  showToggleText: { color: colors.textDim, fontSize: font.tiny, fontWeight: '600' },

  primaryBtn: {
    flexDirection: 'row', gap: 8, height: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary,
  },
  primaryBtnText: { color: '#fff', fontSize: font.body, fontWeight: '800' },
  ghostBtn: {
    flexDirection: 'row', gap: 8, height: 46, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderStrong,
  },
  ghostBtnText: { color: colors.text, fontSize: font.small, fontWeight: '700' },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    flexGrow: 1, flexBasis: '46%', minWidth: '46%',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  statLabel: { color: colors.textFaint, fontSize: font.tiny, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { color: colors.text, fontSize: font.h3, fontWeight: '800' },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardHeadText: { color: colors.textFaint, fontSize: font.tiny, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },
  bigNum: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  bigNumSub: { color: colors.textFaint, fontSize: font.small, fontWeight: '400' },
  tinyDim: { color: colors.textDim, fontSize: font.tiny, marginTop: 6, lineHeight: 16 },
  tinyFaint: { color: colors.textFaint, fontSize: font.tiny, marginTop: 6, lineHeight: 15 },

  barTrack: { height: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', borderRadius: radius.pill },

  collapseCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, overflow: 'hidden',
  },
  collapseHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  collapseHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  collapseHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapseBody: {
    borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.sm, gap: spacing.sm,
  },
  collapseLoading: { paddingVertical: spacing.lg, alignItems: 'center' },

  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowLabel: { color: colors.textDim, fontSize: font.small, flexShrink: 1 },
  rowValue: { color: colors.textDim, fontSize: font.tiny, fontWeight: '600' },

  tabBar: {
    flexDirection: 'row', gap: 3, padding: 4, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.sm },
  tabBtnActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  tabBtnText: { color: colors.textDim, fontSize: font.tiny, fontWeight: '700' },
  tabLoading: { height: 140, alignItems: 'center', justifyContent: 'center' },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: spacing.sm },
  pagerBtn: {
    width: 40, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  pagerText: { color: colors.textDim, fontSize: font.small, minWidth: 96, textAlign: 'center' },

  spaceCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, gap: 4,
  },
  spaceName: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  kvGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  kv: { flexBasis: '46%', flexGrow: 1 },
  kvLabel: { color: colors.textFaint, fontSize: font.tiny, textTransform: 'uppercase', letterSpacing: 0.4 },
  kvValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kvValue: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  spaceMeta: { color: colors.textDim, fontSize: font.tiny },

  payerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  payerName: { color: colors.text, fontSize: font.small, flexShrink: 1 },

  emptyNote: {
    color: colors.textDim, fontSize: font.small, textAlign: 'center', paddingVertical: spacing.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
  },
  perfGrid: { flexDirection: 'row', gap: spacing.sm },
  perfCard: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.sm,
  },
  perfLabel: { color: colors.textFaint, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  perfCount: { color: colors.text, fontSize: font.h3, fontWeight: '800', marginTop: 2 },
  perfCountSub: { color: colors.textFaint, fontSize: font.tiny, fontWeight: '400' },
  perfTotal: { color: colors.textDim, fontSize: font.tiny },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  deltaText: { fontSize: font.h3, fontWeight: '800' },

  sectionTitle: { color: colors.text, fontSize: font.small, fontWeight: '700', marginBottom: spacing.sm },
  barsRow: {
    alignItems: 'flex-end', gap: spacing.sm, padding: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  barCol: { alignItems: 'center', gap: 4, minWidth: 40 },
  barCount: { color: colors.textDim, fontSize: 10 },
  vBar: { width: 22, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: colors.accent },
  barPeriod: { color: colors.textFaint, fontSize: 10 },

  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: font.tiny, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },

  resetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  resetHeadLeft: { flexShrink: 1 },
  resetHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subCard: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, padding: spacing.md, gap: 6,
  },
  subCardTitle: { color: colors.textFaint, fontSize: font.tiny, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },
  answerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  answerValue: { color: colors.text, fontSize: font.small, textAlign: 'right', flexShrink: 1 },
  recentBox: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4, paddingTop: 6, gap: 3 },
  recentTitle: { color: colors.textFaint, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  recentEntry: { color: colors.textDim, fontSize: font.tiny, flexShrink: 1 },
  recentAmount: { color: colors.textDim, fontSize: font.tiny, fontWeight: '600' },
  resetActions: { flexDirection: 'row', gap: spacing.sm },

  errorBox: {
    color: '#ffb3b3', fontSize: font.small,
    backgroundColor: colors.red + '1c', borderWidth: 1, borderColor: colors.red + '4d',
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10,
  },
});
