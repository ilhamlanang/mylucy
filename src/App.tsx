import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  CreditCard,
  Download,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  PiggyBank,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  Wallet as WalletIcon,
  Wand2,
  Wifi,
  WifiOff
} from 'lucide-react';
import {
  Budget,
  BudgetBreakdownItem,
  Category,
  DebtDirection,
  DebtItem,
  Transaction,
  TransactionType,
  Wallet,
  WalletType
} from './types/finance';
import { formatIDR, isSupabaseConfigured, supabase } from './lib/supabase';
import {
  DEFAULT_BUDGETS,
  DEFAULT_CATEGORIES,
  DEFAULT_DEBTS,
  DEFAULT_TRANSACTIONS,
  DEFAULT_WALLETS
} from './lib/seedData';
import {
  FinancialSummaryContext,
  getSavedGeminiApiKey,
  ParsedMutationResult,
  parseTransactionText,
  SAMPLE_MUTATIONS,
  setSavedGeminiApiKey,
  streamLucyAdvisorResponse
} from './lib/aiService';
import { exportTransactionsToCsv } from './lib/exportCsv';
import { ModalDialog } from './components/ModalDialog';
import { WalletSlider } from './components/WalletSlider';
import { CashFlowChart } from './components/CashFlowChart';

type ActiveTab = 'dashboard' | 'transactions' | 'budgets' | 'lucy' | 'categories' | 'wallets';
type SidebarMode = 'expanded' | 'minimized' | 'hidden';
type BudgetSubView = 'all' | 'envelopes' | 'debts';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  engine?: string;
}

interface OfflineSyncItem {
  id: string;
  table: 'transactions' | 'budgets' | 'categories' | 'wallets' | 'debts';
  action: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  queuedAt: string;
}

const STORAGE_KEYS = {
  wallets: 'mylucy_wallets_v1',
  categories: 'mylucy_categories_v1',
  transactions: 'mylucy_transactions_v1',
  budgets: 'mylucy_budgets_v1',
  debts: 'mylucy_debts_v1',
  offlineQueue: 'mylucy_offline_queue_v1',
  sidebarMode: 'mylucy_sidebar_mode_v1'
};

const PRESET_AMOUNTS = [15000, 25000, 50000, 100000, 250000, 500000];
const COLOR_PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f97316', '#ec4899', '#8b5cf6', '#eab308', '#ef4444'];

const LUCY_QUICK_PROMPTS = [
  'Evaluasi kesehatan arus kas & rasio hutang saya bulan ini',
  'Hutang mana yang sebaiknya saya lunasi duluan (Snowball vs Avalanche)?',
  'Kategori apa yang paling banyak menyerap anggaran?',
  'Bagaimana strategi menabung 25% dari pemasukan saya?'
];

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [budgetSubView, setBudgetSubView] = useState<BudgetSubView>('all');
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.sidebarMode);
    return saved === 'minimized' || saved === 'hidden' ? saved : 'expanded';
  });

  const handleSetSidebarMode = (mode: SidebarMode) => {
    setSidebarMode(mode);
    try {
      localStorage.setItem(STORAGE_KEYS.sidebarMode, mode);
    } catch {
      // Ignore storage errors
    }
  };

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [colorScheme, setColorScheme] = useState<'light dark' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('color-scheme');
    return saved === 'light' || saved === 'dark' ? saved : 'light dark';
  });

  const handleSetColorScheme = (scheme: 'light dark' | 'light' | 'dark') => {
    setColorScheme(scheme);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (meta) {
      meta.content = scheme;
    }
    try {
      if (scheme === 'light dark') {
        localStorage.removeItem('color-scheme');
      } else {
        localStorage.setItem('color-scheme', scheme);
      }
    } catch {
      // Ignore storage errors if blocked
    }
  };

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'light dark';
        setColorScheme(next);
        const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
        if (meta) meta.content = next;
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Local / Cloud state
  const [wallets, setWallets] = useState<Wallet[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.wallets);
    return saved ? JSON.parse(saved) : DEFAULT_WALLETS;
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.categories);
    if (!saved) return DEFAULT_CATEGORIES;
    const parsed: Category[] = JSON.parse(saved);
    const missingDefaults = DEFAULT_CATEGORIES.filter(
      (def) => !parsed.some((p) => p.id === def.id || p.name.toLowerCase() === def.name.toLowerCase())
    );
    return missingDefaults.length > 0 ? [...parsed, ...missingDefaults] : parsed;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.transactions);
    return saved ? JSON.parse(saved) : DEFAULT_TRANSACTIONS;
  });

  const [budgets, setBudgets] = useState<Budget[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.budgets);
    if (!saved) return DEFAULT_BUDGETS;
    const parsed: Budget[] = JSON.parse(saved);
    return parsed.map((b) => {
      const def = DEFAULT_BUDGETS.find((d) => d.id === b.id || d.category_id === b.category_id);
      if (b.items === undefined && def?.items) {
        return { ...b, items: def.items };
      }
      return b;
    });
  });

  const [debts, setDebts] = useState<DebtItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.debts);
    return saved ? JSON.parse(saved) : DEFAULT_DEBTS;
  });

  const [offlineQueue, setOfflineQueue] = useState<OfflineSyncItem[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.offlineQueue);
    return saved ? JSON.parse(saved) : [];
  });

  // Modals
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [isSmartParseModalOpen, setIsSmartParseModalOpen] = useState(false);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
  const [isDebtPayModalOpen, setIsDebtPayModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAiKeyModalOpen, setIsAiKeyModalOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    detail?: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Quick Transaction Form state
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txAmount, setTxAmount] = useState<string>('');
  const [txMerchant, setTxMerchant] = useState<string>('');
  const [txDesc, setTxDesc] = useState<string>('');
  const [txCategoryId, setTxCategoryId] = useState<string>('cat-food');
  const [txWalletId, setTxWalletId] = useState<string>('w-bca');
  const [txDate, setTxDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [txSource, setTxSource] = useState<'manual' | 'ai_parsed'>('manual');

  // Smart Budget Form state (Phase 3)
  const [budgetCatId, setBudgetCatId] = useState<string>('cat-food');
  const [budgetLimitInput, setBudgetLimitInput] = useState<string>('2000000');
  const [budgetThresholdInput, setBudgetThresholdInput] = useState<string>('80');
  const [budgetDraftItems, setBudgetDraftItems] = useState<BudgetBreakdownItem[]>([]);
  const [draftItemLabel, setDraftItemLabel] = useState<string>('');
  const [draftItemAmount, setDraftItemAmount] = useState<string>('');
  const [inlineItemInputs, setInlineItemInputs] = useState<
    Record<string, { label: string; amount: string }>
  >({});

  // Debt & Receivable Form state
  const [debtDirection, setDebtDirection] = useState<DebtDirection>('payable');
  const [debtTitle, setDebtTitle] = useState<string>('');
  const [debtCounterparty, setDebtCounterparty] = useState<string>('');
  const [debtTotalInput, setDebtTotalInput] = useState<string>('');
  const [debtInstallmentInput, setDebtInstallmentInput] = useState<string>('');
  const [debtDueDayInput, setDebtDueDayInput] = useState<string>('25');
  const [debtNotesInput, setDebtNotesInput] = useState<string>('');
  const [debtSyncInitialWallet, setDebtSyncInitialWallet] = useState<boolean>(false);
  const [debtInitialWalletId, setDebtInitialWalletId] = useState<string>('w-bca');

  // Debt Payment / Settlement Modal state
  const [selectedDebtForPay, setSelectedDebtForPay] = useState<DebtItem | null>(null);
  const [debtPayAmountInput, setDebtPayAmountInput] = useState<string>('');
  const [debtPayWalletId, setDebtPayWalletId] = useState<string>('w-bca');

  // Smart Parse AI state (Phase 2)
  const [rawMutationText, setRawMutationText] = useState('');
  const [isParsingAi, setIsParsingAi] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<ParsedMutationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Lucy AI Financial Advisor Chat state (Phase 2)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-lucy',
      role: 'assistant',
      text: 'Halo! Aku **Lucy**, asisten keuangan pribadimu. Aku sudah terhubung dengan ringkasan saldo, anggaran, dan riwayat transaksimu bulan ini. Ada yang ingin kamu konsultasikan hari ini?',
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isLucyStreaming, setIsLucyStreaming] = useState(false);
  const [previousInteractionId, setPreviousInteractionId] = useState<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Gemini API Key setting for local dev
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => getSavedGeminiApiKey());

  // New Category Form state
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<TransactionType>('expense');
  const [catColor, setCatColor] = useState(COLOR_PALETTE[0]);

  // New Wallet Form state
  const [walletName, setWalletName] = useState('');
  const [walletType, setWalletType] = useState<WalletType>('bank');
  const [walletInitialBalance, setWalletInitialBalance] = useState('0');
  const [walletColor, setWalletColor] = useState(COLOR_PALETTE[0]);

  // Filters for transaction list
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all');

  // Auth form state
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Modern Web Guidance: Sync aria-invalid with native :user-invalid state
  useEffect(() => {
    const syncAria = (target: EventTarget | null) => {
      if (!(target instanceof HTMLInputElement)) return;
      try {
        target.setAttribute('aria-invalid', target.matches(':user-invalid') ? 'true' : 'false');
      } catch {
        // Fallback if selector is unsupported
      }
    };

    const onBlur = (e: Event) => syncAria(e.target);
    const onInput = (e: Event) => {
      if (e.target instanceof HTMLInputElement && e.target.hasAttribute('aria-invalid')) {
        syncAria(e.target);
      }
    };

    document.addEventListener('blur', onBlur, true);
    document.addEventListener('input', onInput);
    return () => {
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('input', onInput);
    };
  }, []);

  // Track online/offline connectivity
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Mobile Back Gesture & Browser History API Synchronization (SPA Accessibility)
  const isPopStateRef = useRef(false);
  const isAnyModalOpen =
    isTxModalOpen ||
    isSmartParseModalOpen ||
    isBudgetModalOpen ||
    isDebtModalOpen ||
    isDebtPayModalOpen ||
    isCategoryModalOpen ||
    isWalletModalOpen ||
    isAuthModalOpen ||
    isAiKeyModalOpen ||
    Boolean(confirmDialog);

  useEffect(() => {
    if (!window.history.state || !window.history.state.tab) {
      window.history.replaceState(
        { tab: 'dashboard' },
        '',
        `${window.location.pathname}#dashboard`
      );
    }
  }, []);

  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false;
      return;
    }
    if (window.history.state?.tab !== activeTab) {
      window.history.pushState(
        { tab: activeTab },
        '',
        `${window.location.pathname}#${activeTab}`
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTab]);

  useEffect(() => {
    if (isAnyModalOpen && window.history.state?.modal !== true) {
      window.history.pushState(
        { tab: activeTab, modal: true },
        '',
        `${window.location.pathname}#${activeTab}`
      );
    } else if (!isAnyModalOpen && window.history.state?.modal === true) {
      window.history.back();
    }
  }, [isAnyModalOpen, activeTab]);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isAnyModalOpen) {
        isPopStateRef.current = true;
        setIsTxModalOpen(false);
        setIsSmartParseModalOpen(false);
        setIsBudgetModalOpen(false);
        setIsDebtModalOpen(false);
        setIsDebtPayModalOpen(false);
        setIsCategoryModalOpen(false);
        setIsWalletModalOpen(false);
        setIsAuthModalOpen(false);
        setIsAiKeyModalOpen(false);
        setConfirmDialog(null);
        return;
      }

      const prevTab = (e.state?.tab as ActiveTab) || 'dashboard';
      isPopStateRef.current = true;
      setActiveTab(prevTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (!e.state?.tab) {
        window.history.replaceState(
          { tab: 'dashboard' },
          '',
          `${window.location.pathname}#dashboard`
        );
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAnyModalOpen]);

  // Persist to localStorage (Offline-First queue/cache)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wallets, JSON.stringify(wallets));
  }, [wallets]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.categories, JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.budgets, JSON.stringify(budgets));
  }, [budgets]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.debts, JSON.stringify(debts));
  }, [debts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.offlineQueue, JSON.stringify(offlineQueue));
  }, [offlineQueue]);

  // Flush Offline Queue when back online
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && supabase && userId) {
      flushOfflineQueue();
    }
  }, [isOnline, userId]);

  async function flushOfflineQueue() {
    if (!supabase || !userId || offlineQueue.length === 0) return;
    const remaining: OfflineSyncItem[] = [];
    for (const item of offlineQueue) {
      try {
        if (item.action === 'upsert') {
          await supabase.from(item.table).upsert([item.payload]);
        } else if (item.action === 'delete') {
          await supabase.from(item.table).delete().eq('id', item.payload.id);
        }
      } catch {
        remaining.push(item);
      }
    }
    setOfflineQueue(remaining);
  }

  function enqueueOfflineAction(
    table: OfflineSyncItem['table'],
    action: OfflineSyncItem['action'],
    payload: Record<string, unknown>
  ) {
    setOfflineQueue((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        table,
        action,
        payload,
        queuedAt: new Date().toISOString()
      }
    ]);
  }

  // Auto-scroll chat
  useEffect(() => {
    if (activeTab === 'lucy') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, activeTab]);

  // Supabase Auth Session & Cloud Fetch
  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      if (sessionUser) {
        setUserEmail(sessionUser.email ?? null);
        setUserId(sessionUser.id);
        fetchCloudData(sessionUser.id);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user;
      setUserEmail(sessionUser?.email ?? null);
      setUserId(sessionUser?.id ?? null);
      if (sessionUser) {
        fetchCloudData(sessionUser.id);
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function fetchCloudData(uid: string) {
    if (!supabase) return;
    const [wRes, cRes, tRes, bRes, dRes] = await Promise.all([
      supabase.from('wallets').select('*').eq('user_id', uid),
      supabase.from('categories').select('*').or(`user_id.is.null,user_id.eq.${uid}`),
      supabase.from('transactions').select('*').eq('user_id', uid).order('transaction_date', { ascending: false }),
      supabase.from('budgets').select('*').eq('user_id', uid),
      supabase.from('debts').select('*').eq('user_id', uid)
    ]);

    if (wRes.data && wRes.data.length > 0) setWallets(wRes.data);
    if (cRes.data && cRes.data.length > 0) setCategories(cRes.data);
    if (tRes.data) setTransactions(tRes.data);
    if (bRes.data && bRes.data.length > 0) setBudgets(bRes.data);
    if (dRes.data && dRes.data.length > 0) setDebts(dRes.data);
  }

  // Keep default selected category valid when switching txType
  useEffect(() => {
    const matching = categories.filter((c) => c.type === txType);
    if (matching.length > 0 && !matching.some((c) => c.id === txCategoryId)) {
      setTxCategoryId(matching[0].id);
    }
  }, [txType, categories, txCategoryId]);

  useEffect(() => {
    if (wallets.length > 0 && !wallets.some((w) => w.id === txWalletId)) {
      setTxWalletId(wallets[0].id);
    }
    if (wallets.length > 0 && !wallets.some((w) => w.id === debtPayWalletId)) {
      setDebtPayWalletId(wallets[0].id);
    }
    if (wallets.length > 0 && !wallets.some((w) => w.id === debtInitialWalletId)) {
      setDebtInitialWalletId(wallets[0].id);
    }
  }, [wallets, txWalletId, debtPayWalletId, debtInitialWalletId]);

  // Financial & Calendar Calculations
  const currentMonthPrefix = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const calendarMetrics = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = Math.max(now.getDate(), 1);
    const remainingDays = Math.max(daysInMonth - dayOfMonth + 1, 1);
    const monthElapsedPct = Math.round((dayOfMonth / daysInMonth) * 100);
    return { daysInMonth, dayOfMonth, remainingDays, monthElapsedPct };
  }, []);

  const walletBalances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const w of wallets) {
      map[w.id] = Number(w.initial_balance) || 0;
    }
    for (const tx of transactions) {
      if (map[tx.wallet_id] === undefined) map[tx.wallet_id] = 0;
      map[tx.wallet_id] += tx.type === 'income' ? Number(tx.amount) : -Number(tx.amount);
    }
    return map;
  }, [wallets, transactions]);

  const totalBalance = useMemo(
    () => Object.values(walletBalances).reduce((acc, val) => acc + val, 0),
    [walletBalances]
  );

  const monthlyTransactions = useMemo(
    () => transactions.filter((t) => t.transaction_date.startsWith(currentMonthPrefix)),
    [transactions, currentMonthPrefix]
  );

  const monthlyIncome = useMemo(
    () =>
      monthlyTransactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount), 0),
    [monthlyTransactions]
  );

  const monthlyExpense = useMemo(() => {
    const txExpense = monthlyTransactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const txIds = new Set(monthlyTransactions.map((t) => t.id));
    const unlinkedCheckedExpense = budgets.reduce((sum, b) => {
      const checkedWithoutTx = (b.items || [])
        .filter((item) => item.is_checked && (!item.linked_tx_id || !txIds.has(item.linked_tx_id)))
        .reduce((s, item) => s + Number(item.amount || 0), 0);
      return sum + checkedWithoutTx;
    }, 0);

    return txExpense + unlinkedCheckedExpense;
  }, [monthlyTransactions, budgets]);

  const savingsRatePct = useMemo(
    () =>
      monthlyIncome > 0
        ? Math.max(Math.round(((monthlyIncome - monthlyExpense) / monthlyIncome) * 100), 0)
        : 0,
    [monthlyIncome, monthlyExpense]
  );

  // Category Distribution & Proactive Budget Envelope Analysis (Phase 3)
  const expenseByCategory = useMemo(() => {
    const totals: Record<string, number> = {};
    const txIds = new Set<string>();
    for (const tx of monthlyTransactions) {
      txIds.add(tx.id);
      if (tx.type !== 'expense') continue;
      totals[tx.category_id] = (totals[tx.category_id] || 0) + Number(tx.amount);
    }

    const allExpenseCatIds = new Set([
      ...Object.keys(totals),
      ...budgets.map((b) => b.category_id)
    ]);

    return Array.from(allExpenseCatIds)
      .map((catId) => {
        const budget = budgets.find((b) => b.category_id === catId);
        const items = budget?.items || [];
        const itemsTotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const checkedItemsTotal = items
          .filter((item) => item.is_checked)
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const checkedItemsCount = items.filter((item) => item.is_checked).length;

        // Include checked breakdown items that don't already have a corresponding transaction in totals
        const unlinkedCheckedSum = items
          .filter((item) => item.is_checked && (!item.linked_tx_id || !txIds.has(item.linked_tx_id)))
          .reduce((sum, item) => sum + Number(item.amount || 0), 0);

        const amount = (totals[catId] || 0) + unlinkedCheckedSum;
        const cat = categories.find((c) => c.id === catId);
        const pct = monthlyExpense > 0 ? Math.round((amount / monthlyExpense) * 100) : 0;

        const budgetLimit = items.length > 0 ? itemsTotal : budget?.amount_limit || null;
        const alertThreshold = budget?.alert_threshold || 80;
        const budgetRatio = budgetLimit ? Math.round((amount / budgetLimit) * 100) : null;

        // Proactive Pace Analysis: Is spending faster than safe daily burn rate?
        const safeDailyAllowance = budgetLimit
          ? Math.max(Math.round((budgetLimit - amount) / calendarMetrics.remainingDays), 0)
          : null;
        const isOverThreshold = budgetRatio !== null && budgetRatio >= alertThreshold;
        const isPaceWarning =
          budgetRatio !== null &&
          budgetRatio > calendarMetrics.monthElapsedPct + 15 &&
          amount > 0;

        return {
          categoryId: catId,
          budgetId: budget?.id || null,
          name: cat?.name || 'Lainnya',
          color: cat?.color || '#64748b',
          amount,
          percentage: pct,
          budgetLimit,
          alertThreshold,
          budgetRatio,
          safeDailyAllowance,
          isOverThreshold,
          isPaceWarning,
          items,
          itemsTotal,
          checkedItemsTotal,
          checkedItemsCount
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions, categories, monthlyExpense, budgets, calendarMetrics]);

  // Debt & Receivable Obligation Metrics (Integrated into Smart Budgeting)
  const debtMetrics = useMemo(() => {
    const activePayables = debts.filter((d) => d.direction === 'payable' && d.remaining_amount > 0);
    const activeReceivables = debts.filter(
      (d) => d.direction === 'receivable' && d.remaining_amount > 0
    );

    const totalPayableRemaining = activePayables.reduce(
      (sum, d) => sum + Number(d.remaining_amount),
      0
    );
    const totalReceivableRemaining = activeReceivables.reduce(
      (sum, d) => sum + Number(d.remaining_amount),
      0
    );

    // Monthly installment commitment across active payables
    const totalMonthlyCommitment = activePayables.reduce(
      (sum, d) => sum + Math.min(Number(d.monthly_installment), Number(d.remaining_amount)),
      0
    );

    // Unpaid monthly obligation this month (cuts Safe-to-Spend)
    const unpaidMonthlyObligation = activePayables
      .filter((d) => d.last_paid_month !== currentMonthPrefix)
      .reduce(
        (sum, d) => sum + Math.min(Number(d.monthly_installment), Number(d.remaining_amount)),
        0
      );

    // Debt Service Ratio (DSR) against monthly income
    const debtServiceRatioPct =
      monthlyIncome > 0 ? Math.round((totalMonthlyCommitment / monthlyIncome) * 100) : 0;

    // Due-soon (H-3) or Overdue unpaid payable obligations
    const dueAlerts = activePayables
      .filter((d) => d.last_paid_month !== currentMonthPrefix)
      .map((d) => {
        const daysUntilDue = d.due_day - calendarMetrics.dayOfMonth;
        return {
          ...d,
          daysUntilDue,
          installmentDue: Math.min(Number(d.monthly_installment), Number(d.remaining_amount))
        };
      })
      .filter((d) => d.daysUntilDue <= 3)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    return {
      activePayables,
      activeReceivables,
      totalPayableRemaining,
      totalReceivableRemaining,
      totalMonthlyCommitment,
      unpaidMonthlyObligation,
      debtServiceRatioPct,
      dueAlerts
    };
  }, [debts, currentMonthPrefix, monthlyIncome, calendarMetrics.dayOfMonth]);

  // Proactive Warnings List for Banner
  const proactiveWarnings = useMemo(
    () =>
      expenseByCategory.filter(
        (item) => item.budgetLimit && (item.isOverThreshold || item.isPaceWarning)
      ),
    [expenseByCategory]
  );

  const totalAlertCount = proactiveWarnings.length + debtMetrics.dueAlerts.length;

  const totalBudgetAllocated = useMemo(
    () => budgets.reduce((sum, b) => sum + Number(b.amount_limit), 0),
    [budgets]
  );

  // Net Safe-to-Spend after deducting unpaid monthly debt installments
  const netSafeRemainingBudget = useMemo(
    () =>
      Math.max(
        totalBudgetAllocated - monthlyExpense - debtMetrics.unpaidMonthlyObligation,
        0
      ),
    [totalBudgetAllocated, monthlyExpense, debtMetrics.unpaidMonthlyObligation]
  );

  const netSafeDailyAllowance = useMemo(
    () => Math.max(Math.round(netSafeRemainingBudget / calendarMetrics.remainingDays), 0),
    [netSafeRemainingBudget, calendarMetrics.remainingDays]
  );

  // Context Aggregation object for Lucy Advisor
  const financialSummaryContext: FinancialSummaryContext = useMemo(
    () => ({
      totalBalance,
      monthlyIncome,
      monthlyExpense,
      savingsRatePct,
      topCategories: expenseByCategory
        .filter((e) => e.amount > 0)
        .map((e) => ({
          name: e.name,
          amount: e.amount,
          percentage: e.percentage,
          budgetLimit: e.budgetLimit
        })),
      walletBreakdown: wallets.map((w) => ({
        name: w.name,
        balance: walletBalances[w.id] || 0
      })),
      debtSummary: {
        totalPayableRemaining: debtMetrics.totalPayableRemaining,
        totalReceivableRemaining: debtMetrics.totalReceivableRemaining,
        unpaidMonthlyObligation: debtMetrics.unpaidMonthlyObligation,
        debtServiceRatioPct: debtMetrics.debtServiceRatioPct,
        activeDebts: debts
          .filter((d) => d.remaining_amount > 0)
          .map((d) => ({
            title: d.title,
            counterparty: d.counterparty,
            direction: d.direction,
            remainingAmount: d.remaining_amount,
            monthlyInstallment: d.monthly_installment,
            dueDay: d.due_day,
            isPaidThisMonth: d.last_paid_month === currentMonthPrefix
          }))
      }
    }),
    [
      totalBalance,
      monthlyIncome,
      monthlyExpense,
      savingsRatePct,
      expenseByCategory,
      wallets,
      walletBalances,
      debtMetrics,
      debts,
      currentMonthPrefix
    ]
  );

  // Filtered transactions for Transaction History view
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => {
        if (filterType !== 'all' && t.type !== filterType) return false;
        if (filterCategoryId !== 'all' && t.category_id !== filterCategoryId) return false;
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          const catNameMatch = categories
            .find((c) => c.id === t.category_id)
            ?.name.toLowerCase()
            .includes(q);
          const descMatch = t.description?.toLowerCase().includes(q);
          const merchMatch = t.merchant?.toLowerCase().includes(q);
          return Boolean(catNameMatch || descMatch || merchMatch);
        }
        return true;
      })
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  }, [transactions, filterType, filterCategoryId, searchQuery, categories]);

  // Handlers
  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(txAmount.replace(/[^0-9]/g, ''));
    if (!numericAmount || numericAmount <= 0) return;

    const newTx: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId ?? undefined,
      wallet_id: txWalletId,
      category_id: txCategoryId,
      amount: numericAmount,
      type: txType,
      merchant: txMerchant.trim() || undefined,
      description: txDesc.trim() || categories.find((c) => c.id === txCategoryId)?.name || 'Transaksi',
      transaction_date: txDate,
      source: txSource,
      created_at: new Date().toISOString()
    };

    setTransactions((prev) => [newTx, ...prev]);

    if (supabase && userId) {
      if (isOnline) {
        await supabase.from('transactions').insert([newTx]);
      } else {
        enqueueOfflineAction('transactions', 'upsert', newTx as unknown as Record<string, unknown>);
      }
    } else if (!isOnline) {
      enqueueOfflineAction('transactions', 'upsert', newTx as unknown as Record<string, unknown>);
    }

    setTxAmount('');
    setTxMerchant('');
    setTxDesc('');
    setTxSource('manual');
    setIsTxModalOpen(false);
  }

  // Phase 3: Save or Update Category Budget Limit & Breakdown Items
  async function syncBudgetRecord(updatedBudget: Budget) {
    setBudgets((prev) => {
      const filtered = prev.filter((b) => b.category_id !== updatedBudget.category_id);
      return [...filtered, updatedBudget];
    });

    if (supabase && userId && isOnline) {
      await supabase.from('budgets').upsert([updatedBudget]);
    } else if (!isOnline) {
      enqueueOfflineAction('budgets', 'upsert', updatedBudget as unknown as Record<string, unknown>);
    }
  }

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    let finalItems = [...budgetDraftItems];
    const pendingAmount = Number(draftItemAmount.replace(/[^0-9]/g, ''));
    if (draftItemLabel.trim() && pendingAmount > 0) {
      finalItems = [
        ...finalItems,
        {
          id: crypto.randomUUID(),
          label: draftItemLabel.trim(),
          amount: pendingAmount,
          is_checked: false
        }
      ];
    }

    const itemsSum = finalItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const manualLimit = Number(budgetLimitInput.replace(/[^0-9]/g, ''));
    const limitNum = finalItems.length > 0 ? itemsSum : manualLimit;
    const thresholdNum = Math.min(Math.max(Number(budgetThresholdInput) || 80, 10), 100);
    if (!limitNum || limitNum <= 0) return;

    const existing = budgets.find((b) => b.category_id === budgetCatId);
    const updatedBudget: Budget = {
      id: existing?.id || crypto.randomUUID(),
      user_id: userId ?? undefined,
      category_id: budgetCatId,
      month: currentMonthPrefix,
      amount_limit: limitNum,
      alert_threshold: thresholdNum,
      items: finalItems
    };

    await syncBudgetRecord(updatedBudget);
    setDraftItemLabel('');
    setDraftItemAmount('');
    setIsBudgetModalOpen(false);
  }

  function handleDeleteBudget(budgetId: string) {
    const targetBudget = budgets.find((b) => b.id === budgetId);
    const cat = categories.find((c) => c.id === targetBudget?.category_id);
    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Anggaran',
      message:
        'Apakah Anda yakin ingin menghapus alokasi anggaran beserta seluruh rincian poin pada kategori ini?',
      detail: cat
        ? `Kategori: ${cat.name} (${formatIDR(targetBudget?.amount_limit || 0)})`
        : undefined,
      confirmLabel: 'Ya, Hapus Anggaran',
      onConfirm: async () => {
        setBudgets((prev) => prev.filter((b) => b.id !== budgetId));
        if (supabase && userId && isOnline) {
          await supabase.from('budgets').delete().eq('id', budgetId);
        }
        setConfirmDialog(null);
      }
    });
  }

  function openEditBudgetModal(categoryId: string, currentLimit?: number | null, currentThreshold?: number) {
    const existing = budgets.find((b) => b.category_id === categoryId);
    const existingItems = existing?.items || [];
    const itemsSum = existingItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    setBudgetCatId(categoryId);
    setBudgetDraftItems(existingItems);
    setDraftItemLabel('');
    setDraftItemAmount('');
    setBudgetLimitInput(String(existingItems.length > 0 ? itemsSum : currentLimit || 1500000));
    setBudgetThresholdInput(String(currentThreshold || 80));
    setIsBudgetModalOpen(true);
  }

  function handleAddDraftBudgetItem() {
    const amt = Number(draftItemAmount.replace(/[^0-9]/g, ''));
    if (!draftItemLabel.trim() || amt <= 0) return;
    const nextItems: BudgetBreakdownItem[] = [
      ...budgetDraftItems,
      {
        id: crypto.randomUUID(),
        label: draftItemLabel.trim(),
        amount: amt,
        is_checked: false
      }
    ];
    setBudgetDraftItems(nextItems);
    const nextSum = nextItems.reduce((sum, item) => sum + item.amount, 0);
    setBudgetLimitInput(String(nextSum));
    setDraftItemLabel('');
    setDraftItemAmount('');
  }

  function handleRemoveDraftBudgetItem(itemId: string) {
    const nextItems = budgetDraftItems.filter((item) => item.id !== itemId);
    setBudgetDraftItems(nextItems);
    if (nextItems.length > 0) {
      const nextSum = nextItems.reduce((sum, item) => sum + item.amount, 0);
      setBudgetLimitInput(String(nextSum));
    }
  }

  async function handleAddInlineBudgetItem(categoryId: string) {
    const input = inlineItemInputs[categoryId];
    if (!input) return;
    const amt = Number(input.amount.replace(/[^0-9]/g, ''));
    if (!input.label.trim() || amt <= 0) return;

    const existing = budgets.find((b) => b.category_id === categoryId);
    const prevItems = existing?.items || [];
    const nextItems: BudgetBreakdownItem[] = [
      ...prevItems,
      {
        id: crypto.randomUUID(),
        label: input.label.trim(),
        amount: amt,
        is_checked: false
      }
    ];
    const nextTotal = nextItems.reduce((sum, item) => sum + item.amount, 0);

    const updatedBudget: Budget = {
      id: existing?.id || crypto.randomUUID(),
      user_id: userId ?? undefined,
      category_id: categoryId,
      month: currentMonthPrefix,
      amount_limit: nextTotal,
      alert_threshold: existing?.alert_threshold || 80,
      items: nextItems
    };

    await syncBudgetRecord(updatedBudget);
    setInlineItemInputs((prev) => ({
      ...prev,
      [categoryId]: { label: '', amount: '' }
    }));
  }

  async function handleToggleBudgetItem(categoryId: string, itemId: string) {
    const existing = budgets.find((b) => b.category_id === categoryId);
    if (!existing || !existing.items) return;

    const targetItem = existing.items.find((item) => item.id === itemId);
    if (!targetItem) return;

    const nextChecked = !targetItem.is_checked;
    let nextLinkedTxId: string | null | undefined = targetItem.linked_tx_id;

    if (nextChecked) {
      // Create a linked expense transaction so "Terpakai di Transaksi" & Riwayat Transaksi increase automatically
      const catObj = categories.find((c) => c.id === categoryId);
      const defaultWalletId = wallets[0]?.id || 'w-bca';
      const newTx: Transaction = {
        id: crypto.randomUUID(),
        user_id: userId ?? undefined,
        wallet_id: defaultWalletId,
        category_id: categoryId,
        amount: Number(targetItem.amount),
        type: 'expense',
        merchant: catObj?.name || 'Rincian Anggaran',
        description: `Realisasi Anggaran: ${targetItem.label}`,
        transaction_date: new Date().toISOString().slice(0, 10),
        source: 'manual',
        created_at: new Date().toISOString()
      };
      nextLinkedTxId = newTx.id;
      setTransactions((prev) => [newTx, ...prev]);

      if (supabase && userId && isOnline) {
        await supabase.from('transactions').insert([newTx]);
      } else if (!isOnline) {
        enqueueOfflineAction(
          'transactions',
          'upsert',
          newTx as unknown as Record<string, unknown>
        );
      }
    } else {
      // Unchecked: remove the linked transaction if one was created
      if (targetItem.linked_tx_id) {
        const txIdToRemove = targetItem.linked_tx_id;
        setTransactions((prev) => prev.filter((t) => t.id !== txIdToRemove));
        if (supabase && userId && isOnline) {
          await supabase.from('transactions').delete().eq('id', txIdToRemove);
        }
      }
      nextLinkedTxId = null;
    }

    const nextItems = existing.items.map((item) =>
      item.id === itemId
        ? { ...item, is_checked: nextChecked, linked_tx_id: nextLinkedTxId }
        : item
    );
    const updatedBudget: Budget = {
      ...existing,
      items: nextItems
    };
    await syncBudgetRecord(updatedBudget);
  }

  function handleDeleteInlineBudgetItem(categoryId: string, itemId: string) {
    const existing = budgets.find((b) => b.category_id === categoryId);
    if (!existing || !existing.items) return;

    const targetItem = existing.items.find((item) => item.id === itemId);
    if (!targetItem) return;

    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Poin Rincian',
      message: 'Apakah Anda yakin ingin menghapus poin rincian anggaran ini?',
      detail: `${targetItem.label} • ${formatIDR(targetItem.amount)}`,
      confirmLabel: 'Ya, Hapus Poin',
      onConfirm: async () => {
        if (targetItem.linked_tx_id) {
          const txIdToRemove = targetItem.linked_tx_id;
          setTransactions((prev) => prev.filter((t) => t.id !== txIdToRemove));
          if (supabase && userId && isOnline) {
            await supabase.from('transactions').delete().eq('id', txIdToRemove);
          }
        }

        const nextItems = existing.items!.filter((item) => item.id !== itemId);
        const nextTotal = nextItems.reduce((sum, item) => sum + item.amount, 0);
        const updatedBudget: Budget = {
          ...existing,
          amount_limit: nextItems.length > 0 ? nextTotal : existing.amount_limit,
          items: nextItems
        };
        await syncBudgetRecord(updatedBudget);
        setConfirmDialog(null);
      }
    });
  }

  // Debt & Receivable Handlers
  async function handleAddDebt(e: React.FormEvent) {
    e.preventDefault();
    const totalNum = Number(debtTotalInput.replace(/[^0-9]/g, ''));
    const installmentNum =
      Number(debtInstallmentInput.replace(/[^0-9]/g, '')) || totalNum;
    const dueDayNum = Math.min(Math.max(Number(debtDueDayInput) || 25, 1), 31);
    if (!debtTitle.trim() || !debtCounterparty.trim() || totalNum <= 0) return;

    const newDebt: DebtItem = {
      id: crypto.randomUUID(),
      user_id: userId ?? undefined,
      title: debtTitle.trim(),
      counterparty: debtCounterparty.trim(),
      direction: debtDirection,
      total_amount: totalNum,
      remaining_amount: totalNum,
      monthly_installment: Math.min(installmentNum, totalNum),
      due_day: dueDayNum,
      last_paid_month: null,
      notes: debtNotesInput.trim() || undefined,
      created_at: new Date().toISOString()
    };

    setDebts((prev) => [newDebt, ...prev]);

    if (supabase && userId && isOnline) {
      await supabase.from('debts').upsert([newDebt]);
    } else if (!isOnline) {
      enqueueOfflineAction('debts', 'upsert', newDebt as unknown as Record<string, unknown>);
    }

    // Optional: If user checked "Catat pencairan/pemberian dana ke Saldo Kantong sekarang"
    if (debtSyncInitialWallet && debtInitialWalletId) {
      const txTypeForInitial: TransactionType =
        debtDirection === 'payable' ? 'income' : 'expense';
      const defaultCatId =
        debtDirection === 'payable'
          ? categories.find((c) => c.type === 'income')?.id || 'cat-freelance'
          : categories.find((c) => c.id === 'cat-debt' || c.type === 'expense')?.id || 'cat-debt';

      const initialTx: Transaction = {
        id: crypto.randomUUID(),
        user_id: userId ?? undefined,
        wallet_id: debtInitialWalletId,
        category_id: defaultCatId,
        amount: totalNum,
        type: txTypeForInitial,
        merchant: debtCounterparty.trim(),
        description:
          debtDirection === 'payable'
            ? `Pencairan Pinjaman: ${debtTitle.trim()}`
            : `Pinjaman Diberikan (Piutang): ${debtTitle.trim()}`,
        transaction_date: new Date().toISOString().slice(0, 10),
        source: 'manual',
        created_at: new Date().toISOString()
      };

      setTransactions((prev) => [initialTx, ...prev]);
      if (supabase && userId && isOnline) {
        await supabase.from('transactions').insert([initialTx]);
      } else if (!isOnline) {
        enqueueOfflineAction(
          'transactions',
          'upsert',
          initialTx as unknown as Record<string, unknown>
        );
      }
    }

    setDebtTitle('');
    setDebtCounterparty('');
    setDebtTotalInput('');
    setDebtInstallmentInput('');
    setDebtNotesInput('');
    setDebtSyncInitialWallet(false);
    setIsDebtModalOpen(false);
  }

  function handleDeleteDebt(debtId: string) {
    const targetDebt = debts.find((d) => d.id === debtId);
    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Catatan Komitmen',
      message:
        'Apakah Anda yakin ingin menghapus catatan hutang/piutang ini secara permanen dari daftar komitmen?',
      detail: targetDebt
        ? `${targetDebt.title} (${targetDebt.counterparty}) • Sisa: ${formatIDR(targetDebt.remaining_amount)}`
        : undefined,
      confirmLabel: 'Ya, Hapus Catatan',
      onConfirm: async () => {
        setDebts((prev) => prev.filter((d) => d.id !== debtId));
        if (supabase && userId && isOnline) {
          await supabase.from('debts').delete().eq('id', debtId);
        } else if (!isOnline) {
          enqueueOfflineAction('debts', 'delete', { id: debtId });
        }
        setConfirmDialog(null);
      }
    });
  }

  function openDebtPayModal(debt: DebtItem) {
    setSelectedDebtForPay(debt);
    const defaultPay = Math.min(debt.monthly_installment, debt.remaining_amount);
    setDebtPayAmountInput(String(defaultPay));
    if (wallets.length > 0 && !wallets.some((w) => w.id === debtPayWalletId)) {
      setDebtPayWalletId(wallets[0].id);
    }
    setIsDebtPayModalOpen(true);
  }

  async function handleSettleDebtInstallment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDebtForPay) return;
    const payNum = Number(debtPayAmountInput.replace(/[^0-9]/g, ''));
    if (!payNum || payNum <= 0) return;

    const actualPay = Math.min(payNum, selectedDebtForPay.remaining_amount);
    const updatedDebt: DebtItem = {
      ...selectedDebtForPay,
      remaining_amount: Math.max(selectedDebtForPay.remaining_amount - actualPay, 0),
      last_paid_month: currentMonthPrefix
    };

    setDebts((prev) => prev.map((d) => (d.id === updatedDebt.id ? updatedDebt : d)));

    if (supabase && userId && isOnline) {
      await supabase.from('debts').upsert([updatedDebt]);
    } else if (!isOnline) {
      enqueueOfflineAction('debts', 'upsert', updatedDebt as unknown as Record<string, unknown>);
    }

    // Automatically record linked Transaction & deduct/credit selected Wallet
    const isPayable = selectedDebtForPay.direction === 'payable';
    const targetCategory = isPayable
      ? categories.find(
          (c) => c.id === 'cat-debt' || c.name.toLowerCase().includes('hutang')
        ) || categories.find((c) => c.type === 'expense')
      : categories.find(
          (c) => c.id === 'cat-receivable' || c.name.toLowerCase().includes('piutang')
        ) || categories.find((c) => c.type === 'income');

    const linkedTx: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId ?? undefined,
      wallet_id: debtPayWalletId,
      category_id: targetCategory?.id || (isPayable ? 'cat-debt' : 'cat-receivable'),
      amount: actualPay,
      type: isPayable ? 'expense' : 'income',
      merchant: selectedDebtForPay.counterparty,
      description: isPayable
        ? `Bayar Cicilan/Hutang: ${selectedDebtForPay.title}${
            updatedDebt.remaining_amount === 0 ? ' (LUNAS)' : ''
          }`
        : `Terima Pelunasan Piutang: ${selectedDebtForPay.title}${
            updatedDebt.remaining_amount === 0 ? ' (LUNAS)' : ''
          }`,
      transaction_date: new Date().toISOString().slice(0, 10),
      source: 'manual',
      created_at: new Date().toISOString()
    };

    setTransactions((prev) => [linkedTx, ...prev]);

    if (supabase && userId && isOnline) {
      await supabase.from('transactions').insert([linkedTx]);
    } else if (!isOnline) {
      enqueueOfflineAction(
        'transactions',
        'upsert',
        linkedTx as unknown as Record<string, unknown>
      );
    }

    setIsDebtPayModalOpen(false);
    setSelectedDebtForPay(null);
  }

  // Phase 2: Smart Parsing Handler
  async function handleRunSmartParse(e: React.FormEvent) {
    e.preventDefault();
    if (!rawMutationText.trim() || !isOnline) return;

    setIsParsingAi(true);
    setParseError(null);
    setParsedPreview(null);

    try {
      const result = await parseTransactionText(rawMutationText, categories);
      setParsedPreview(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Gagal mengekstrak teks mutasi.');
    } finally {
      setIsParsingAi(false);
    }
  }

  function handleApplyParsedResult() {
    if (!parsedPreview) return;

    const matchedCat =
      categories.find(
        (c) =>
          c.type === parsedPreview.type &&
          c.name.toLowerCase() === parsedPreview.category_name.toLowerCase()
      ) ||
      categories.find((c) => c.type === parsedPreview.type) ||
      categories[0];

    const lowerRaw = rawMutationText.toLowerCase();
    const matchedWallet =
      wallets.find((w) => lowerRaw.includes(w.name.toLowerCase())) ||
      (lowerRaw.includes('gopay') || lowerRaw.includes('shopeepay') || lowerRaw.includes('ovo')
        ? wallets.find((w) => w.type === 'ewallet')
        : wallets[0]) ||
      wallets[0];

    setTxType(parsedPreview.type);
    setTxAmount(String(parsedPreview.amount));
    setTxMerchant(parsedPreview.merchant);
    setTxDesc(parsedPreview.description);
    if (matchedCat) setTxCategoryId(matchedCat.id);
    if (matchedWallet) setTxWalletId(matchedWallet.id);
    setTxDate(parsedPreview.transaction_date);
    setTxSource('ai_parsed');

    setIsSmartParseModalOpen(false);
    setParsedPreview(null);
    setRawMutationText('');
    setIsTxModalOpen(true);
  }

  // Phase 2: Lucy Advisor Chat Handler
  async function handleSendLucyMessage(promptText?: string) {
    const question = (promptText ?? chatInput).trim();
    if (!question || isLucyStreaming || !isOnline) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: question,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };

    const assistantMsgId = crypto.randomUUID();
    const placeholderAssistant: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      text: '',
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    };

    setChatInput('');
    setIsLucyStreaming(true);
    setChatMessages((prev) => [...prev, userMsg, placeholderAssistant]);

    try {
      const result = await streamLucyAdvisorResponse(
        question,
        financialSummaryContext,
        previousInteractionId,
        (deltaChunk) => {
          setChatMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, text: m.text + deltaChunk } : m))
          );
        }
      );

      if (result.interactionId) {
        setPreviousInteractionId(result.interactionId);
      }

      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, engine: result.engine } : m))
      );
    } catch (err) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                text: `Maaf, terjadi kendala saat menghubungi layanan AI: ${
                  err instanceof Error ? err.message : 'Error tidak diketahui'
                }`
              }
            : m
        )
      );
    } finally {
      setIsLucyStreaming(false);
    }
  }

  function handleDeleteTransaction(id: string) {
    const targetTx = transactions.find((t) => t.id === id);
    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Transaksi',
      message: 'Apakah Anda yakin ingin menghapus catatan transaksi ini secara permanen?',
      detail: targetTx
        ? `${targetTx.merchant || targetTx.description} • ${formatIDR(targetTx.amount)}`
        : undefined,
      confirmLabel: 'Ya, Hapus Transaksi',
      onConfirm: async () => {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        // If this transaction was linked to a budget breakdown item, uncheck it cleanly
        setBudgets((prev) =>
          prev.map((b) =>
            b.items?.some((item) => item.linked_tx_id === id)
              ? {
                  ...b,
                  items: b.items.map((item) =>
                    item.linked_tx_id === id
                      ? { ...item, is_checked: false, linked_tx_id: null }
                      : item
                  )
                }
              : b
          )
        );
        if (supabase && userId && isOnline) {
          await supabase.from('transactions').delete().eq('id', id);
        } else if (!isOnline) {
          enqueueOfflineAction('transactions', 'delete', { id });
        }
        setConfirmDialog(null);
      }
    });
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;

    const newCat: Category = {
      id: crypto.randomUUID(),
      user_id: userId ?? 'local-user',
      name: catName.trim(),
      icon: 'Tag',
      color: catColor,
      type: catType
    };

    setCategories((prev) => [...prev, newCat]);
    if (supabase && userId && isOnline) {
      await supabase.from('categories').insert([
        {
          id: newCat.id,
          user_id: userId,
          name: newCat.name,
          icon: newCat.icon,
          color: newCat.color,
          type: newCat.type
        }
      ]);
    }

    setCatName('');
    setIsCategoryModalOpen(false);
  }

  function handleDeleteCategory(id: string) {
    const targetCat = categories.find((c) => c.id === id);
    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Kategori',
      message: 'Apakah Anda yakin ingin menghapus kategori kustom ini?',
      detail: targetCat ? `Kategori: ${targetCat.name}` : undefined,
      confirmLabel: 'Ya, Hapus Kategori',
      onConfirm: async () => {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        if (supabase && userId && isOnline) {
          await supabase.from('categories').delete().eq('id', id);
        }
        setConfirmDialog(null);
      }
    });
  }

  async function handleAddWallet(e: React.FormEvent) {
    e.preventDefault();
    if (!walletName.trim()) return;

    const newWallet: Wallet = {
      id: crypto.randomUUID(),
      user_id: userId ?? undefined,
      name: walletName.trim(),
      type: walletType,
      initial_balance: Number(walletInitialBalance.replace(/[^0-9]/g, '')) || 0,
      color: walletColor
    };

    setWallets((prev) => [...prev, newWallet]);
    if (supabase && userId && isOnline) {
      await supabase.from('wallets').insert([newWallet]);
    }

    setWalletName('');
    setWalletInitialBalance('0');
    setIsWalletModalOpen(false);
  }

  function handleDeleteWallet(id: string) {
    if (wallets.length <= 1) return;
    const targetWallet = wallets.find((w) => w.id === id);
    setConfirmDialog({
      title: 'Konfirmasi Penghapusan Dompet',
      message: 'Apakah Anda yakin ingin menghapus kantong/dompet dana ini?',
      detail: targetWallet ? `Dompet: ${targetWallet.name}` : undefined,
      confirmLabel: 'Ya, Hapus Dompet',
      onConfirm: async () => {
        setWallets((prev) => prev.filter((w) => w.id !== id));
        if (supabase && userId && isOnline) {
          await supabase.from('wallets').delete().eq('id', id);
        }
        setConfirmDialog(null);
      }
    });
  }

  function handleRequestResetAllData() {
    document.getElementById('header-settings-panel')?.hidePopover?.();
    setConfirmDialog({
      title: 'Konfirmasi Pengaturan Ulang Data',
      message:
        'Apakah Anda yakin ingin menghapus seluruh data contoh/catatan saat ini dan memulai ulang dari saldo Rp 0?',
      detail:
        'Seluruh riwayat transaksi, alokasi anggaran, serta catatan hutang dan piutang pada perangkat ini akan dikosongkan secara permanen. Saldo awal seluruh dompet akan diatur menjadi Rp 0.',
      confirmLabel: 'Ya, Reset Seluruh Data',
      onConfirm: async () => {
        const zeroWallets = DEFAULT_WALLETS.map((w) => ({ ...w, initial_balance: 0 }));
        setTransactions([]);
        setBudgets([]);
        setDebts([]);
        setWallets(zeroWallets);
        setCategories(DEFAULT_CATEGORIES);
        setOfflineQueue([]);
        setConfirmDialog(null);
      }
    });
  }

  async function handleSupabaseAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);
    setAuthMessage(null);

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        setIsAuthModalOpen(false);
      } else {
        const { error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        setAuthMessage('Registrasi berhasil! Silakan cek email atau login.');
      }
    } catch (err: unknown) {
      setAuthMessage(err instanceof Error ? err.message : 'Terjadi kesalahan autentikasi.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUserEmail(null);
    setUserId(null);
  }

  function handleSaveGeminiKey(e: React.FormEvent) {
    e.preventDefault();
    setSavedGeminiApiKey(geminiKeyInput);
    setIsAiKeyModalOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Sidebar Navigation */}
      <aside
        aria-label="Navigasi Utama Desktop"
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 z-30 bg-slate-900 text-white border-r border-slate-800 transition-all duration-300 ease-in-out ${
          sidebarMode === 'expanded'
            ? 'lg:w-72 lg:translate-x-0'
            : sidebarMode === 'minimized'
            ? 'lg:w-20 lg:translate-x-0'
            : 'lg:w-72 lg:-translate-x-full lg:pointer-events-none lg:opacity-0'
        }`}
      >
        <div
          className={`flex items-center border-b border-slate-800 ${
            sidebarMode === 'minimized'
              ? 'flex-col gap-2.5 px-2 py-4 justify-center'
              : 'justify-between px-5 py-5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/logo.png"
              alt="MyLucy Logo"
              onClick={() => sidebarMode === 'minimized' && handleSetSidebarMode('expanded')}
              title={sidebarMode === 'minimized' ? 'Perbesar Sidebar MyLucy' : 'MyLucy — Smart Personal Finance'}
              className={`h-10 w-10 shrink-0 rounded-xl object-cover shadow-lg shadow-indigo-500/30 border border-violet-500/30 ${
                sidebarMode === 'minimized' ? 'cursor-pointer hover:scale-105 transition-transform' : ''
              }`}
            />
            {sidebarMode === 'expanded' && (
              <div className="truncate">
                <h1 className="text-lg font-bold tracking-tight">MyLucy</h1>
                <p className="text-xs text-slate-400 truncate">Smart Personal Finance</p>
              </div>
            )}
          </div>

          {/* Sidebar Minimize & Hide Controls */}
          <div
            className={`flex items-center ${
              sidebarMode === 'minimized' ? 'flex-col gap-1' : 'gap-1'
            }`}
          >
            <button
              type="button"
              onClick={() =>
                handleSetSidebarMode(sidebarMode === 'minimized' ? 'expanded' : 'minimized')
              }
              title={
                sidebarMode === 'minimized'
                  ? 'Perbesar Sidebar (Expand)'
                  : 'Kecilkan Sidebar ke Mode Ikon (Minimize)'
              }
              aria-label={
                sidebarMode === 'minimized'
                  ? 'Perbesar Sidebar'
                  : 'Kecilkan Sidebar ke Mode Ikon'
              }
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            >
              {sidebarMode === 'minimized' ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleSetSidebarMode('hidden')}
              title="Sembunyikan Sidebar (Hide)"
              aria-label="Sembunyikan Sidebar"
              className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={`${sidebarMode === 'minimized' ? 'px-2.5 py-4' : 'px-4 py-5'} space-y-2`}>
          <button
            type="button"
            onClick={() => {
              setTxSource('manual');
              setIsTxModalOpen(true);
            }}
            title="Catat Transaksi Cepat"
            className={`w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 ${
              sidebarMode === 'minimized' ? 'p-3' : 'px-4 py-3'
            } text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all cursor-pointer`}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {sidebarMode === 'expanded' && <span>Catat Transaksi Cepat</span>}
          </button>

          <button
            type="button"
            disabled={!isOnline}
            onClick={() => setIsSmartParseModalOpen(true)}
            title={
              !isOnline
                ? 'Fitur AI membutuhkan koneksi internet'
                : 'Smart Parse Mutasi (AI) — Ekstrak mutasi otomatis dengan AI'
            }
            className={`w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600/25 hover:bg-violet-600/35 border border-violet-500/40 ${
              sidebarMode === 'minimized' ? 'p-2.5' : 'px-4 py-2.5'
            } text-xs font-semibold text-violet-200 transition-all cursor-pointer disabled:opacity-50`}
          >
            <Wand2 className="h-4 w-4 text-violet-300 shrink-0" />
            {sidebarMode === 'expanded' && <span>Smart Parse Mutasi (AI)</span>}
          </button>
        </div>

        <nav className={`flex-1 ${sidebarMode === 'minimized' ? 'px-2.5' : 'px-4'} space-y-1`}>
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            title="Ringkasan & Grafik"
            className={`w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'gap-3 px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'dashboard'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="h-4 w-4 text-indigo-400 shrink-0" />
            {sidebarMode === 'expanded' && <span>Ringkasan & Grafik</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('transactions')}
            title="Riwayat Transaksi"
            className={`w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'gap-3 px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'transactions'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <ListFilter className="h-4 w-4 text-emerald-400 shrink-0" />
            {sidebarMode === 'expanded' && <span>Riwayat Transaksi</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('budgets')}
            title={
              totalAlertCount > 0
                ? `Smart Budgeting (${totalAlertCount} Alert)`
                : 'Smart Budgeting'
            }
            className={`relative w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'justify-between px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'budgets'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <span className="flex items-center gap-3">
              <Target className="h-4 w-4 text-rose-400 shrink-0" />
              {sidebarMode === 'expanded' && <span>Smart Budgeting</span>}
            </span>
            {totalAlertCount > 0 && sidebarMode === 'expanded' && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                {totalAlertCount} Alert
              </span>
            )}
            {totalAlertCount > 0 && sidebarMode === 'minimized' && (
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('lucy')}
            title="Lucy AI Advisor"
            className={`relative w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'justify-between px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'lucy'
                ? 'bg-gradient-to-r from-indigo-600/30 to-violet-600/30 text-white border border-indigo-500/30'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <span className="flex items-center gap-3">
              <Bot className="h-4 w-4 text-violet-400 shrink-0" />
              {sidebarMode === 'expanded' && <span>Lucy AI Advisor</span>}
            </span>
            {sidebarMode === 'expanded' && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                AI
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wallets')}
            title="Dompet & Kantong"
            className={`w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'gap-3 px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'wallets'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <CreditCard className="h-4 w-4 text-sky-400 shrink-0" />
            {sidebarMode === 'expanded' && <span>Dompet & Kantong</span>}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            title="Kategori Kustom"
            className={`w-full flex items-center ${
              sidebarMode === 'minimized' ? 'justify-center p-3' : 'gap-3 px-4 py-2.5'
            } rounded-xl text-sm font-medium transition-colors cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`}
          >
            <FolderKanban className="h-4 w-4 text-amber-400 shrink-0" />
            {sidebarMode === 'expanded' && <span>Kategori Kustom</span>}
          </button>
        </nav>

        {/* Connection & Offline Queue Footer */}
        {sidebarMode === 'expanded' ? (
          <div className="p-4 m-4 rounded-xl bg-slate-800/80 border border-slate-700/70 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Status Jaringan</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  isOnline ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {isOnline ? 'Online' : 'Offline PWA'}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Antrean Offline</span>
              <span className="inline-flex items-center gap-1 font-medium text-indigo-300">
                {offlineQueue.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setOfflineQueue([])}
                    className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 cursor-pointer"
                    title="Klik untuk menandai sinkron"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {offlineQueue.length} item tertunda
                  </button>
                ) : userEmail ? (
                  <>
                    <Cloud className="h-3.5 w-3.5 text-emerald-400" />
                    Tersinkronisasi
                  </>
                ) : (
                  <>
                    <CloudOff className="h-3.5 w-3.5 text-slate-400" />
                    Local Storage
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {userEmail ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="col-span-1 flex items-center justify-center gap-1 rounded-lg bg-slate-700 hover:bg-rose-600/80 py-1.5 text-[11px] font-medium text-white transition-colors cursor-pointer"
                >
                  <LogOut className="h-3 w-3" /> Keluar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAuthModalOpen(true)}
                  className="col-span-1 flex items-center justify-center gap-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-1.5 text-[11px] font-medium text-white transition-colors cursor-pointer"
                >
                  <LogIn className="h-3 w-3" /> Cloud Sync
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsAiKeyModalOpen(true)}
                className="col-span-1 flex items-center justify-center gap-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-1.5 text-[11px] font-medium text-violet-300 transition-colors cursor-pointer"
              >
                <KeyRound className="h-3 w-3" /> Gemini Key
              </button>
            </div>
          </div>
        ) : (
          <div className="p-2.5 m-2 rounded-xl bg-slate-800/80 border border-slate-700/70 flex flex-col items-center gap-2">
            <span
              title={isOnline ? 'Status Jaringan: Online' : 'Status Jaringan: Offline PWA'}
              className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                isOnline ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
              }`}
            >
              {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            </span>

            {userEmail ? (
              <button
                type="button"
                onClick={handleSignOut}
                title="Keluar (Sign Out)"
                className="h-8 w-8 rounded-lg bg-slate-700 hover:bg-rose-600/80 flex items-center justify-center text-white transition-colors cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                title="Cloud Sync (Login / Signup)"
                className="h-8 w-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-white transition-colors cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsAiKeyModalOpen(true)}
              title="Pengaturan Gemini API Key"
              className="h-8 w-8 rounded-lg bg-slate-700 hover:bg-slate-600 flex items-center justify-center text-violet-300 transition-colors cursor-pointer"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div
        className={`flex-1 pb-24 lg:pb-12 transition-all duration-300 ease-in-out ${
          sidebarMode === 'expanded'
            ? 'lg:pl-72'
            : sidebarMode === 'minimized'
            ? 'lg:pl-20'
            : 'lg:pl-0'
        }`}
      >
        {/* Top Mobile/Desktop Header */}
        <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Desktop Sidebar Toggle Button */}
            <button
              type="button"
              onClick={() => {
                if (sidebarMode === 'expanded') {
                  handleSetSidebarMode('minimized');
                } else if (sidebarMode === 'minimized') {
                  handleSetSidebarMode('hidden');
                } else {
                  handleSetSidebarMode('expanded');
                }
              }}
              title={
                sidebarMode === 'expanded'
                  ? 'Minimize Sidebar (Mode Ikon)'
                  : sidebarMode === 'minimized'
                  ? 'Sembunyikan Sidebar (Hide)'
                  : 'Tampilkan Sidebar (Show)'
              }
              aria-label="Toggle Sidebar Desktop"
              className="hidden lg:inline-flex h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 items-center justify-center text-slate-700 transition-colors cursor-pointer"
            >
              {sidebarMode === 'hidden' ? (
                <PanelLeftOpen className="h-4 w-4 text-indigo-600" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            {activeTab !== 'dashboard' ? (
              <button
                type="button"
                onClick={() => {
                  if (window.history.state?.tab && window.history.length > 1) {
                    window.history.back();
                  } else {
                    setActiveTab('dashboard');
                  }
                }}
                aria-label="Kembali ke halaman sebelumnya"
                title="Kembali"
                className="lg:hidden h-9 w-9 shrink-0 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            ) : (
              <img
                src="/logo.png"
                alt="MyLucy Logo"
                className="lg:hidden h-9 w-9 shrink-0 rounded-xl object-cover shadow-md border border-violet-500/30"
              />
            )}
            <div>
              <h2 className="text-base sm:text-xl font-bold text-slate-900">
                {activeTab === 'dashboard' && 'Dashboard Keuangan'}
                {activeTab === 'transactions' && 'Riwayat Transaksi'}
                {activeTab === 'budgets' && 'Smart Budgeting & Komitmen Hutang'}
                {activeTab === 'lucy' && 'Lucy — AI Financial Advisor'}
                {activeTab === 'wallets' && 'Dompet & Sumber Dana'}
                {activeTab === 'categories' && 'Manajemen Kategori Kustom'}
              </h2>
              <p className="text-xs text-slate-500 leading-snug">
                <span className="block">
                  Periode berjalan:{' '}
                  {new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
                </span>
                <span className="block text-[11px] text-slate-400">
                  Sisa {calendarMetrics.remainingDays} hari di bulan ini
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-2">
              <button
                type="button"
                disabled={!isOnline}
                onClick={() => setIsSmartParseModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-2 text-xs sm:text-sm font-semibold text-violet-700 transition-colors cursor-pointer disabled:opacity-40"
              >
                <Wand2 className="h-4 w-4 text-violet-600" />
                <span>Smart Parse AI</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTxSource('manual');
                  setIsTxModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Transaksi Baru</span>
              </button>
            </div>

            {/* Top-Right Settings Button (Mobile & Desktop) */}
            <button
              type="button"
              popoverTarget="header-settings-panel"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/80 flex items-center justify-center text-slate-700 transition-colors cursor-pointer"
              aria-label="Pengaturan tampilan dan ekspor data"
              title="Pengaturan"
            >
              <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>

            {/* Top-Right Settings Popover Panel */}
            <div
              id="header-settings-panel"
              popover="auto"
              className="header-settings-popover flex-col gap-3 rounded-2xl bg-white p-4 shadow-2xl border border-slate-200/90"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Mode Tampilan
                </p>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100">
                  <button
                    type="button"
                    onClick={() => handleSetColorScheme('light')}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 px-1 text-[11px] font-semibold transition-all cursor-pointer ${
                      colorScheme === 'light'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Sun className="h-4 w-4" />
                    <span>Light</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetColorScheme('dark')}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 px-1 text-[11px] font-semibold transition-all cursor-pointer ${
                      colorScheme === 'dark'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Moon className="h-4 w-4" />
                    <span>Dark</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetColorScheme('light dark')}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 px-1 text-[11px] font-semibold transition-all cursor-pointer ${
                      colorScheme === 'light dark'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Monitor className="h-4 w-4" />
                    <span>Sistem</span>
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Data & Laporan
                </p>
                <button
                  type="button"
                  onClick={() => {
                    document.getElementById('header-settings-panel')?.hidePopover?.();
                    exportTransactionsToCsv(transactions, categories, wallets);
                  }}
                  className="w-full flex items-center justify-between rounded-xl bg-slate-50/80 hover:bg-indigo-50/60 border border-slate-200/80 px-3.5 py-2.5 text-xs font-semibold text-slate-800 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-indigo-600" />
                    Ekspor CSV / Excel
                  </span>
                  <span className="text-[10px] text-slate-400">{transactions.length} baris</span>
                </button>

                <button
                  type="button"
                  onClick={handleRequestResetAllData}
                  className="w-full flex items-center justify-between rounded-xl bg-rose-50/70 hover:bg-rose-100/80 border border-rose-200/80 px-3.5 py-2.5 text-xs font-semibold text-rose-700 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-rose-600" />
                    Reset Data (Mulai Rp 0)
                  </span>
                  <span className="text-[10px] font-medium text-rose-500">Bersihkan</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-8 pt-6 space-y-6">
          {/* PHASE 3: PROACTIVE BUDGET & DEBT DUE WARNING BANNER */}
          {totalAlertCount > 0 && (activeTab === 'dashboard' || activeTab === 'budgets') && (
            <div className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 border border-amber-200/90 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <BellRing className="h-5 w-5 text-amber-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-slate-900">
                    Peringatan Proaktif Smart Budgeting ({totalAlertCount} Perhatian)
                  </h3>
                  {debtMetrics.dueAlerts.length > 0 && (
                    <p className="text-xs text-rose-700 font-medium leading-relaxed">
                      {debtMetrics.dueAlerts
                        .map((d) =>
                          d.daysUntilDue < 0
                            ? `Tagihan ${d.title} (${d.counterparty}) sebesar ${formatIDR(
                                d.installmentDue
                              )} TERLAMBAT ${Math.abs(d.daysUntilDue)} hari!`
                            : d.daysUntilDue === 0
                            ? `Tagihan ${d.title} (${d.counterparty}) sebesar ${formatIDR(
                                d.installmentDue
                              )} jatuh tempo HARI INI!`
                            : `Cicilan ${d.title} (${d.counterparty}) sebesar ${formatIDR(
                                d.installmentDue
                              )} jatuh tempo ${d.daysUntilDue} hari lagi (Tgl ${d.due_day})`
                        )
                        .join(' • ')}
                    </p>
                  )}
                  {proactiveWarnings.length > 0 && (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {proactiveWarnings
                        .map((w) =>
                          w.isOverThreshold
                            ? `${w.name} telah mencapai ${w.budgetRatio}% dari kuota (${formatIDR(
                                w.amount
                              )} / ${formatIDR(w.budgetLimit!)})`
                            : `Laju pengeluaran ${w.name} (${w.budgetRatio}%) melampaui kecepatan normal bulan berjalan (${calendarMetrics.monthElapsedPct}%)`
                        )
                        .join(' • ')}
                    </p>
                  )}
                </div>
              </div>
              {activeTab !== 'budgets' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('budgets')}
                  className="shrink-0 rounded-xl bg-amber-600 hover:bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  Cek Budget & Cicilan &rarr;
                </button>
              )}
            </div>
          )}

          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              {/* Hero Summary Cards: Total Saldo full-width on mobile, Pemasukan & Pengeluaran side-by-side */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                <div className="col-span-2 md:col-span-1 rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-5 sm:p-6 text-white shadow-xl shadow-indigo-600/15">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wider text-indigo-100">
                      Total Saldo Gabungan
                    </span>
                    <WalletIcon className="h-5 w-5 text-indigo-200" />
                  </div>
                  <p className="mt-2.5 sm:mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight">
                    {formatIDR(totalBalance)}
                  </p>
                  <p className="mt-2 text-xs text-indigo-200 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                    Terhitung dari {wallets.length} kantong dana aktif
                  </p>
                </div>

                <div className="col-span-1 rounded-2xl bg-white p-4 sm:p-6 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Pemasukan
                    </span>
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600" />
                    </div>
                  </div>
                  <p className="mt-2 sm:mt-3 text-sm sm:text-2xl font-bold text-slate-900 truncate">
                    {formatIDR(monthlyIncome)}
                  </p>
                  <p className="mt-1 sm:mt-2 text-[11px] sm:text-xs text-emerald-600 font-medium">
                    +{monthlyTransactions.filter((t) => t.type === 'income').length} transaksi masuk
                  </p>
                </div>

                <div className="col-span-1 rounded-2xl bg-white p-4 sm:p-6 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Pengeluaran
                    </span>
                    <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                      <ArrowDownRight className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-600" />
                    </div>
                  </div>
                  <p className="mt-2 sm:mt-3 text-sm sm:text-2xl font-bold text-slate-900 truncate">
                    {formatIDR(monthlyExpense)}
                  </p>
                  <p className="mt-1 sm:mt-2 text-[11px] sm:text-xs text-rose-600 font-medium">
                    {monthlyTransactions.filter((t) => t.type === 'expense').length} transaksi keluar
                  </p>
                </div>
              </div>

              {/* Rincian Saldo per Kantong — Horizontal Slider Card */}
              <WalletSlider
                wallets={wallets}
                walletBalances={walletBalances}
                totalBalance={totalBalance}
                onManageWallets={() => setActiveTab('wallets')}
              />

              {/* Multi-column Desktop Layout: Interactive Line Chart + Collapsible Category Breakdown & Recent Transactions */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <CashFlowChart
                  monthlyTransactions={monthlyTransactions}
                  expenseByCategory={expenseByCategory}
                  savingsRatePct={savingsRatePct}
                  onOpenBudgets={() => setActiveTab('budgets')}
                />

                {/* Recent Transactions Card */}
                <div className="lg:col-span-6 rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">Transaksi Terakhir</h3>
                        <p className="text-xs text-slate-500">
                          Catatan arus kas terbaru secara real-time
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('transactions')}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 cursor-pointer"
                      >
                        Lihat Semua &rarr;
                      </button>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {transactions.slice(0, 6).map((tx) => {
                        const cat = categories.find((c) => c.id === tx.category_id);
                        const wallet = wallets.find((w) => w.id === tx.wallet_id);
                        return (
                          <div
                            key={tx.id}
                            className="py-3.5 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0"
                                style={{ backgroundColor: cat?.color || '#6366f1' }}
                              >
                                {cat?.name.slice(0, 2).toUpperCase() || 'TX'}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-sm font-semibold text-slate-900 truncate">
                                    {tx.merchant || tx.description}
                                  </p>
                                  {tx.source === 'ai_parsed' && (
                                    <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                      <Sparkles className="h-2.5 w-2.5" /> AI
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 truncate">
                                  {cat?.name || 'Kategori'} &bull; {wallet?.name || 'Dompet'} &bull;{' '}
                                  {tx.transaction_date}
                                </p>
                              </div>
                            </div>

                            <span
                              className={`text-sm font-bold shrink-0 ${
                                tx.type === 'income' ? 'text-emerald-600' : 'text-slate-900'
                              }`}
                            >
                              {tx.type === 'income' ? '+' : '-'}
                              {formatIDR(tx.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: TRANSACTIONS HISTORY */}
          {activeTab === 'transactions' && (
            <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row gap-3 justify-between">
                <div className="relative flex-1">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari merchant, deskripsi, atau kategori..."
                    className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as 'all' | TransactionType)}
                    className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="all">Semua Tipe</option>
                    <option value="expense">Pengeluaran</option>
                    <option value="income">Pemasukan</option>
                  </select>

                  <select
                    value={filterCategoryId}
                    onChange={(e) => setFilterCategoryId(e.target.value)}
                    className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="all">Semua Kategori</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => exportTransactionsToCsv(filteredTransactions, categories, wallets)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    Unduh CSV / Excel
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {filteredTransactions.length > 0 ? (
                  filteredTransactions.map((tx) => {
                    const cat = categories.find((c) => c.id === tx.category_id);
                    const wallet = wallets.find((w) => w.id === tx.wallet_id);
                    return (
                      <div
                        key={tx.id}
                        className="py-4 flex items-center justify-between gap-4 hover:bg-slate-50/70 px-2 rounded-xl transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shrink-0"
                            style={{ backgroundColor: cat?.color || '#6366f1' }}
                          >
                            {cat?.name.slice(0, 2).toUpperCase() || 'TX'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">
                                {tx.merchant ? `${tx.merchant} — ${tx.description}` : tx.description}
                              </p>
                              {tx.source === 'ai_parsed' && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                  <Sparkles className="h-2.5 w-2.5" /> AI Parsed
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              {cat?.name} &bull; {wallet?.name} &bull; {tx.transaction_date}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`text-sm font-bold ${
                              tx.type === 'income' ? 'text-emerald-600' : 'text-slate-900'
                            }`}
                          >
                            {tx.type === 'income' ? '+' : '-'}
                            {formatIDR(tx.amount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteTransaction(tx.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Hapus transaksi"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    Tidak ada transaksi yang cocok dengan pencarian Anda.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SMART BUDGETING & KOMITMEN HUTANG/PIUTANG (PHASE 3) */}
          {activeTab === 'budgets' && (
            <div className="space-y-6">
              {/* Top 3 Integrated Smart Budgeting + Debt Obligation KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Alokasi & Komitmen Wajib
                    </span>
                    <p className="mt-2 text-2xl font-extrabold text-slate-900">
                      {formatIDR(totalBudgetAllocated)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {budgets.length} amplop kategori &bull; Cicilan belum dibayar:{' '}
                      <strong className="text-rose-600">
                        {formatIDR(debtMetrics.unpaidMonthlyObligation)}
                      </strong>
                    </p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Pengeluaran berjalan:</span>
                    <span className="font-bold text-slate-800">{formatIDR(monthlyExpense)}</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Sisa Safe-to-Spend (Net)
                      </span>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        Setelah Cicilan
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-extrabold text-emerald-600">
                      {formatIDR(netSafeRemainingBudget)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Sudah dikurangi kewajiban cicilan bulan ini (
                      {formatIDR(debtMetrics.unpaidMonthlyObligation)})
                    </p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Batas aman harian:</span>
                    <strong className="text-emerald-700 text-sm">
                      {formatIDR(netSafeDailyAllowance)}/hari
                    </strong>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Rasio Cicilan (DSR)
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          debtMetrics.debtServiceRatioPct < 30
                            ? 'bg-emerald-50 text-emerald-700'
                            : debtMetrics.debtServiceRatioPct <= 40
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {debtMetrics.debtServiceRatioPct < 30
                          ? 'Sehat (<30%)'
                          : debtMetrics.debtServiceRatioPct <= 40
                          ? 'Waspada (30-40%)'
                          : 'Kritis (>40%)'}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-extrabold text-slate-900">
                      {debtMetrics.debtServiceRatioPct}%{' '}
                      <span className="text-xs font-normal text-slate-400">dari pemasukan</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Total Hutang:{' '}
                      <strong className="text-rose-600">
                        {formatIDR(debtMetrics.totalPayableRemaining)}
                      </strong>{' '}
                      &bull; Piutang:{' '}
                      <strong className="text-emerald-600">
                        {formatIDR(debtMetrics.totalReceivableRemaining)}
                      </strong>
                    </p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Komitmen cicilan/bln:</span>
                    <span className="font-bold text-slate-800">
                      {formatIDR(debtMetrics.totalMonthlyCommitment)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-Navigation & Action Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setBudgetSubView('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      budgetSubView === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Semua Terpadu
                  </button>
                  <button
                    type="button"
                    onClick={() => setBudgetSubView('debts')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      budgetSubView === 'debts'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span>Hutang & Piutang</span>
                    <span className="rounded-full bg-rose-100 text-rose-700 px-1.5 py-0.2 text-[10px] font-bold">
                      {debts.filter((d) => d.remaining_amount > 0).length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBudgetSubView('envelopes')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      budgetSubView === 'envelopes'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Amplop Kategori ({budgets.length})
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDebtDirection('payable');
                      setIsDebtModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    Catat Hutang / Piutang
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openEditBudgetModal(
                        categories.find((c) => c.type === 'expense')?.id || 'cat-food'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                  >
                    <PiggyBank className="h-4 w-4" />
                    Atur Amplop Anggaran
                  </button>
                </div>
              </div>

              {/* SECTION A: KOMITMEN HUTANG, CICILAN & PIUTANG */}
              {(budgetSubView === 'all' || budgetSubView === 'debts') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        Komitmen Hutang, Cicilan & Piutang
                      </h3>
                      <p className="text-xs text-slate-500">
                        Pembayaran cicilan otomatis memotong sisa pokok sekaligus mencatat transaksi pada Kantong yang dipilih.
                      </p>
                    </div>
                  </div>

                  {debts.length === 0 ? (
                    <div className="rounded-2xl bg-white p-8 border border-slate-200/80 text-center space-y-2">
                      <p className="text-sm font-semibold text-slate-700">
                        Belum ada catatan hutang, cicilan, atau piutang.
                      </p>
                      <p className="text-xs text-slate-400">
                        Klik tombol &ldquo;+ Catat Hutang / Piutang&rdquo; di atas untuk mulai memantau kewajiban bulanan.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {debts.map((debt) => {
                        const isPayable = debt.direction === 'payable';
                        const isSettled = debt.remaining_amount <= 0;
                        const isPaidThisMonth =
                          isSettled || debt.last_paid_month === currentMonthPrefix;
                        const paidAmount = Math.max(debt.total_amount - debt.remaining_amount, 0);
                        const paidPct =
                          debt.total_amount > 0
                            ? Math.min(Math.round((paidAmount / debt.total_amount) * 100), 100)
                            : 100;
                        const daysUntilDue = debt.due_day - calendarMetrics.dayOfMonth;
                        const isDueSoon = !isPaidThisMonth && isPayable && daysUntilDue <= 3;

                        return (
                          <div
                            key={debt.id}
                            className={`rounded-2xl bg-white p-5 border shadow-sm transition-all flex flex-col justify-between ${
                              isSettled
                                ? 'border-slate-200/60 opacity-75'
                                : isDueSoon
                                ? 'border-rose-300 ring-1 ring-rose-200'
                                : 'border-slate-200/80'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                        isPayable
                                          ? 'bg-rose-50 text-rose-700 border border-rose-200/70'
                                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                                      }`}
                                    >
                                      {isPayable ? (
                                        <ArrowUpRight className="h-3 w-3" />
                                      ) : (
                                        <ArrowDownRight className="h-3 w-3" />
                                      )}
                                      {isPayable ? 'Hutang / Cicilan Saya' : 'Piutang (Dipinjam Orang)'}
                                    </span>

                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        isSettled
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : isPaidThisMonth
                                          ? 'bg-indigo-50 text-indigo-700'
                                          : daysUntilDue < 0
                                          ? 'bg-rose-100 text-rose-800 font-bold'
                                          : daysUntilDue <= 3
                                          ? 'bg-amber-100 text-amber-800 font-bold'
                                          : 'bg-slate-100 text-slate-600'
                                      }`}
                                    >
                                      {isSettled
                                        ? 'LUNAS PENUH'
                                        : isPaidThisMonth
                                        ? 'Bulan Ini Sudah Dibayar'
                                        : daysUntilDue < 0
                                        ? `Terlambat ${Math.abs(daysUntilDue)} Hari (Tgl ${debt.due_day})`
                                        : daysUntilDue === 0
                                        ? `Jatuh Tempo HARI INI (Tgl ${debt.due_day})`
                                        : `Jatuh Tempo Tgl ${debt.due_day} (${daysUntilDue} hr lagi)`}
                                    </span>
                                  </div>

                                  <h4 className="font-bold text-slate-900 text-base pt-0.5">
                                    {debt.title}
                                  </h4>
                                  <p className="text-xs text-slate-500">
                                    {isPayable ? 'Kreditur / Platform:' : 'Peminjam:'}{' '}
                                    <strong className="text-slate-700">{debt.counterparty}</strong>
                                    {debt.notes ? ` • ${debt.notes}` : ''}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteDebt(debt.id)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                                  title="Hapus catatan hutang/piutang"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>

                              <div className="mt-4 space-y-2">
                                <div className="flex items-baseline justify-between">
                                  <div>
                                    <span className="text-[11px] text-slate-400 block">
                                      {isPayable ? 'Sisa Pokok Hutang' : 'Sisa Piutang Belum Kembali'}
                                    </span>
                                    <span
                                      className={`text-lg font-extrabold ${
                                        isSettled
                                          ? 'text-emerald-600 line-through'
                                          : isPayable
                                          ? 'text-rose-600'
                                          : 'text-emerald-600'
                                      }`}
                                    >
                                      {formatIDR(debt.remaining_amount)}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[11px] text-slate-400 block">
                                      Tagihan / Bulan
                                    </span>
                                    <span className="text-sm font-bold text-slate-800">
                                      {formatIDR(
                                        Math.min(debt.monthly_installment, debt.remaining_amount || debt.monthly_installment)
                                      )}
                                      /bln
                                    </span>
                                  </div>
                                </div>

                                {/* Repayment Progress Bar */}
                                <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{
                                      width: `${paidPct}%`,
                                      backgroundColor: isSettled
                                        ? '#10b981'
                                        : isPayable
                                        ? '#4f46e5'
                                        : '#0ea5e9'
                                    }}
                                  />
                                </div>

                                <div className="flex items-center justify-between text-xs text-slate-500">
                                  <span>
                                    Terbayar <strong>{paidPct}%</strong> ({formatIDR(paidAmount)})
                                  </span>
                                  <span>Total Awal: {formatIDR(debt.total_amount)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                              {isSettled ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                                  <CheckCircle2 className="h-4 w-4" />
                                  Seluruh kewajiban telah lunas!
                                </span>
                              ) : (
                                <>
                                  <span className="text-[11px] text-slate-500">
                                    {isPaidThisMonth
                                      ? 'Cicilan periode ini sudah tercatat'
                                      : isPayable
                                      ? 'Memotong Safe-to-Spend bulan ini'
                                      : 'Menunggu pelunasan masuk ke dompet'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openDebtPayModal(debt)}
                                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer ${
                                      isPayable
                                        ? 'bg-indigo-600 hover:bg-indigo-500'
                                        : 'bg-emerald-600 hover:bg-emerald-500'
                                    }`}
                                  >
                                    <CreditCard className="h-3.5 w-3.5" />
                                    {isPayable ? 'Bayar Cicilan' : 'Terima Pelunasan'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* SECTION B: AMPLOP ANGGARAN PER KATEGORI (ENVELOPE SYSTEM) */}
              {(budgetSubView === 'all' || budgetSubView === 'envelopes') && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Amplop Anggaran Kategori (Envelope System)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Rinci setiap amplop anggaran dengan poin-poin kebutuhan. Total poin rincian otomatis menjadi Batas Anggaran (Limit) kategori.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {categories
                      .filter((c) => c.type === 'expense')
                      .map((cat) => {
                        const stats = expenseByCategory.find((e) => e.categoryId === cat.id);
                        const spent = stats?.amount || 0;
                        const limit = stats?.budgetLimit || null;
                        const ratio = stats?.budgetRatio ?? 0;
                        const threshold = stats?.alertThreshold ?? 80;
                        const isWarn = Boolean(stats?.isOverThreshold || stats?.isPaceWarning);
                        const items = stats?.items || [];
                        const itemsTotal = stats?.itemsTotal || 0;
                        const checkedItemsTotal = stats?.checkedItemsTotal || 0;
                        const checkedItemsCount = stats?.checkedItemsCount || 0;
                        const inlineInput = inlineItemInputs[cat.id] || { label: '', amount: '' };

                        return (
                          <div
                            key={cat.id}
                            className={`rounded-2xl bg-white p-6 border shadow-sm transition-all flex flex-col justify-between ${
                              isWarn
                                ? 'border-amber-300 ring-1 ring-amber-200'
                                : 'border-slate-200/80'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span
                                    className="h-4 w-4 rounded-full shrink-0"
                                    style={{ backgroundColor: cat.color }}
                                  />
                                  <div>
                                    <h4 className="font-bold text-slate-900">{cat.name}</h4>
                                    <p className="text-xs text-slate-500">
                                      {limit
                                        ? items.length > 0
                                          ? `Limit otomatis dari ${items.length} poin rincian • Peringatan ${threshold}%`
                                          : `Ambang peringatan pada ${threshold}% kuota`
                                        : 'Belum ada batas anggaran'}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openEditBudgetModal(cat.id, limit, threshold)}
                                    className="rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                                  >
                                    {limit ? 'Ubah Rincian / Limit' : '+ Set Budget'}
                                  </button>
                                  {stats?.budgetId && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteBudget(stats.budgetId!)}
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                      title="Hapus alokasi anggaran"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="mt-5 space-y-2">
                                <div className="flex items-baseline justify-between">
                                  <div>
                                    <span className="text-[11px] text-slate-400 block">
                                      Terpakai di Transaksi
                                    </span>
                                    <span className="text-lg font-extrabold text-slate-900">
                                      {formatIDR(spent)}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-[11px] text-slate-400 block">
                                      Limit Amplop Kategori
                                    </span>
                                    <span className="text-xs font-semibold text-slate-600">
                                      {limit ? `${formatIDR(limit)} (${ratio}%)` : 'Tanpa Limit'}
                                    </span>
                                  </div>
                                </div>

                                {limit && (
                                  <>
                                    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                      <div
                                        className="h-full rounded-full transition-all duration-300"
                                        style={{
                                          width: `${Math.min(ratio, 100)}%`,
                                          backgroundColor:
                                            ratio >= 100
                                              ? '#dc2626'
                                              : isWarn
                                              ? '#f59e0b'
                                              : cat.color
                                        }}
                                      />
                                    </div>

                                    <div className="flex items-center justify-between text-xs pt-1">
                                      <span
                                        className={
                                          isWarn ? 'text-amber-700 font-semibold' : 'text-slate-500'
                                        }
                                      >
                                        {ratio >= 100
                                          ? 'Melebihi Anggaran!'
                                          : isWarn
                                          ? 'Perhatian: Mendekati batas kuota'
                                          : 'Status Aman'}
                                      </span>
                                      <span className="text-slate-500">
                                        Batas harian:{' '}
                                        <strong>{formatIDR(stats?.safeDailyAllowance || 0)}</strong>
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* RINCIAN POIN ANGGARAN (BREAKDOWN ITEMS + CHECKLIST + TOTAL) */}
                              <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    Rincian Poin Anggaran
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                      {items.length} poin
                                    </span>
                                  </span>
                                  {items.length > 0 && (
                                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                                      Terealisasi {checkedItemsCount}/{items.length}
                                    </span>
                                  )}
                                </div>

                                {items.length === 0 ? (
                                  <p className="text-[11px] text-slate-400 italic py-1">
                                    Belum ada poin rincian. Tambahkan poin di bawah untuk menghitung total anggaran otomatis.
                                  </p>
                                ) : (
                                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/70 bg-slate-50/50 overflow-hidden">
                                    {items.map((item) => (
                                      <div
                                        key={item.id}
                                        className="flex items-center justify-between gap-2 px-3 hover:bg-slate-100/70 transition-colors"
                                      >
                                        <label className="flex items-center gap-2.5 min-h-[44px] flex-1 cursor-pointer select-none py-1.5">
                                          <input
                                            type="checkbox"
                                            checked={item.is_checked}
                                            onChange={() => handleToggleBudgetItem(cat.id, item.id)}
                                            style={{ accentColor: cat.color }}
                                            className="h-[1.15em] w-[1.15em] aspect-square m-0 cursor-pointer shrink-0"
                                          />
                                          <span
                                            className={`text-xs font-medium leading-snug ${
                                              item.is_checked
                                                ? 'line-through text-slate-400'
                                                : 'text-slate-800'
                                            }`}
                                          >
                                            {item.label}
                                          </span>
                                        </label>

                                        <div className="flex items-center gap-2 shrink-0">
                                          <span
                                            className={`text-xs font-bold ${
                                              item.is_checked
                                                ? 'text-emerald-600 line-through opacity-75'
                                                : 'text-slate-900'
                                            }`}
                                          >
                                            {formatIDR(item.amount)}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleDeleteInlineBudgetItem(cat.id, item.id)
                                            }
                                            title="Hapus poin rincian"
                                            className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    ))}

                                    {/* BARIS TOTAL RINCIAN POIN */}
                                    <div className="bg-slate-100/90 px-3 py-2.5 space-y-1">
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-slate-700">
                                          Total Rincian (= Limit Amplop)
                                        </span>
                                        <span className="font-extrabold text-indigo-700 text-sm">
                                          {formatIDR(itemsTotal)}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                                        <span>
                                          Terealisasi:{' '}
                                          <strong className="text-emerald-700">
                                            {formatIDR(checkedItemsTotal)}
                                          </strong>
                                        </span>
                                        <span>
                                          Belum Terealisasi:{' '}
                                          <strong className="text-slate-700">
                                            {formatIDR(Math.max(itemsTotal - checkedItemsTotal, 0))}
                                          </strong>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* FORM INLINE TAMBAH POIN RINCIAN */}
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 pt-1">
                                  <input
                                    type="text"
                                    value={inlineInput.label}
                                    onChange={(e) =>
                                      setInlineItemInputs((prev) => ({
                                        ...prev,
                                        [cat.id]: {
                                          label: e.target.value,
                                          amount: prev[cat.id]?.amount || ''
                                        }
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddInlineBudgetItem(cat.id);
                                      }
                                    }}
                                    placeholder="+ Nama poin (mis: Token Listrik)"
                                    className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="number"
                                      min="1000"
                                      value={inlineInput.amount}
                                      onChange={(e) =>
                                        setInlineItemInputs((prev) => ({
                                          ...prev,
                                          [cat.id]: {
                                            label: prev[cat.id]?.label || '',
                                            amount: e.target.value
                                          }
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleAddInlineBudgetItem(cat.id);
                                        }
                                      }}
                                      placeholder="Nominal (Rp)"
                                      className="w-full sm:w-32 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold focus:border-indigo-500 focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleAddInlineBudgetItem(cat.id)}
                                      className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      Tambah
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: LUCY AI FINANCIAL ADVISOR (PHASE 2) */}
          {activeTab === 'lucy' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Financial Context Aggregation Summary */}
              <div className="lg:col-span-4 space-y-4">
                <div className="rounded-2xl bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-6 text-white shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-2xl bg-white/15 flex items-center justify-center">
                      <Bot className="h-6 w-6 text-violet-200" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base">Lucy AI Advisor</h3>
                      <p className="text-xs text-violet-200">Powered by Gemini 3.8 Flash</p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-indigo-100 leading-relaxed">
                    Lucy menganalisis ringkasan agregat transaksi dan kuota anggaranmu secara instan
                    tanpa membebani kuota token.
                  </p>
                  <div className="mt-4 pt-4 border-t border-white/15 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-indigo-200">Saldo Aktif:</span>
                      <span className="font-bold">{formatIDR(totalBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-indigo-200">Pengeluaran Bulan Ini:</span>
                      <span className="font-bold">{formatIDR(monthlyExpense)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-indigo-200">Rasio Tabungan:</span>
                      <span className="font-bold text-emerald-300">{savingsRatePct}%</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Topik Konsultasi Cepat
                  </h4>
                  <div className="space-y-2">
                    {LUCY_QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={!isOnline || isLucyStreaming}
                        onClick={() => handleSendLucyMessage(q)}
                        className="w-full text-left rounded-xl border border-slate-200/80 hover:border-indigo-300 hover:bg-indigo-50/50 p-3 text-xs font-medium text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        &ldquo;{q}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Interactive Streaming Chat */}
              <div className="lg:col-span-8 rounded-2xl bg-white border border-slate-200/80 shadow-sm flex flex-col h-[560px]">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-sm font-bold text-slate-900">
                      Ruang Konsultasi Keuangan
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAiKeyModalOpen(true)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-500 flex items-center gap-1 cursor-pointer"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {getSavedGeminiApiKey() ? 'Gemini API Aktif' : 'Atur API Key'}
                  </button>
                </div>

                {!isOnline && (
                  <div className="mx-6 mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 flex items-center gap-2">
                    <WifiOff className="h-4 w-4 shrink-0" />
                    Fitur AI membutuhkan koneksi internet. Pencatatan transaksi manual tetap dapat
                    digunakan secara offline.
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-br-xs'
                            : 'bg-slate-100 text-slate-800 rounded-bl-xs'
                        }`}
                      >
                        <p>{msg.text || 'Sedang menganalisis data keuanganmu...'}</p>
                        <div
                          className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${
                            msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'
                          }`}
                        >
                          {msg.engine && <span>{msg.engine}</span>}
                          <span>{msg.timestamp}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatBottomRef} />
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendLucyMessage();
                  }}
                  className="p-4 border-t border-slate-100 flex items-center gap-2"
                >
                  <input
                    type="text"
                    disabled={!isOnline || isLucyStreaming}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={
                      isOnline
                        ? 'Tanyakan strategi budget, tabungan, atau evaluasi pengeluaran...'
                        : 'Sambungkan internet untuk berkonsultasi dengan Lucy...'
                    }
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
                  />
                  <button
                    type="submit"
                    disabled={!isOnline || isLucyStreaming || !chatInput.trim()}
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-3 text-white transition-colors cursor-pointer"
                    aria-label="Kirim pesan"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: WALLETS MANAGEMENT */}
          {activeTab === 'wallets' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Kelola kantong dana tunai, rekening bank, dan e-wallet Anda.
                </p>
                <button
                  type="button"
                  onClick={() => setIsWalletModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Tambah Dompet
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {wallets.map((w) => (
                  <div
                    key={w.id}
                    className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold"
                          style={{ backgroundColor: w.color }}
                        >
                          <CreditCard className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900">{w.name}</h4>
                          <span className="text-xs uppercase tracking-wider text-slate-400">
                            {w.type}
                          </span>
                        </div>
                      </div>
                      {wallets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteWallet(w.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Hapus dompet"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100">
                      <span className="text-xs text-slate-400">Saldo Saat Ini</span>
                      <p className="text-xl font-extrabold text-slate-900">
                        {formatIDR(walletBalances[w.id] || 0)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: CUSTOM CATEGORIES */}
          {activeTab === 'categories' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Buat, ubah, atau hapus kategori pemasukan & pengeluaran sesuai gaya hidup Anda.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Kategori Baru
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(['expense', 'income'] as TransactionType[]).map((typeGroup) => (
                  <div
                    key={typeGroup}
                    className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4"
                  >
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                      {typeGroup === 'expense' ? 'Kategori Pengeluaran' : 'Kategori Pemasukan'}
                    </h3>
                    <div className="divide-y divide-slate-100">
                      {categories
                        .filter((c) => c.type === typeGroup)
                        .map((cat) => (
                          <div
                            key={cat.id}
                            className="py-3 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className="h-4 w-4 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="text-sm font-semibold text-slate-800">
                                {cat.name}
                              </span>
                              {cat.user_id === null && (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                  Default
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                              title="Hapus kategori"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-slate-200 px-2 py-1.5 flex items-center justify-around">
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-medium cursor-pointer ${
            activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard className="h-5 w-5" />
          <span>Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('budgets')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-medium cursor-pointer ${
            activeTab === 'budgets' ? 'text-indigo-600' : 'text-slate-400'
          }`}
        >
          <Target className="h-5 w-5" />
          <span>Budget</span>
        </button>

        <button
          type="button"
          popoverTarget="mobile-plus-action-panel"
          className="h-12 w-12 -mt-5 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 flex items-center justify-center cursor-pointer"
          aria-label="Pilih metode tambah transaksi"
        >
          <Plus className="h-6 w-6" />
        </button>

        {/* Mobile (+) Action Panel Popover: 2 Options (Transaksi Cepat vs Transaksi Pakai AI) */}
        <div
          id="mobile-plus-action-panel"
          popover="auto"
          className="mobile-action-popover flex-col gap-2 rounded-2xl bg-white p-3 shadow-2xl border border-slate-200/90"
        >
          <p className="px-2 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Pilih Metode Input Transaksi
          </p>
          <button
            type="button"
            onClick={() => {
              document.getElementById('mobile-plus-action-panel')?.hidePopover?.();
              setTxSource('manual');
              setIsTxModalOpen(true);
            }}
            className="w-full flex items-center gap-3 rounded-xl bg-indigo-50/70 hover:bg-indigo-100/80 border border-indigo-100 p-3 text-left transition-colors cursor-pointer"
          >
            <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-sm font-bold text-slate-900">Transaksi Cepat</span>
              <span className="block text-[11px] text-slate-500">
                Catat manual kurang dari 5 detik
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={!isOnline}
            onClick={() => {
              document.getElementById('mobile-plus-action-panel')?.hidePopover?.();
              setIsSmartParseModalOpen(true);
            }}
            className="w-full flex items-center gap-3 rounded-xl bg-violet-50/70 hover:bg-violet-100/80 border border-violet-100 p-3 text-left transition-colors cursor-pointer disabled:opacity-50"
          >
            <div className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-sm font-bold text-slate-900">Transaksi Pakai AI</span>
              <span className="block text-[11px] text-slate-500">
                {isOnline
                  ? 'Tempel teks mutasi / notifikasi otomatis'
                  : 'Butuh koneksi internet'}
              </span>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('lucy')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-medium cursor-pointer ${
            activeTab === 'lucy' ? 'text-violet-600' : 'text-slate-400'
          }`}
        >
          <Bot className="h-5 w-5" />
          <span>Lucy AI</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('transactions')}
          className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl text-[11px] font-medium cursor-pointer ${
            activeTab === 'transactions' ? 'text-indigo-600' : 'text-slate-400'
          }`}
        >
          <ListFilter className="h-5 w-5" />
          <span>Riwayat</span>
        </button>
      </nav>

      {/* MODAL 1: QUICK ADD TRANSACTION (< 5 seconds workflow) */}
      <ModalDialog
        isOpen={isTxModalOpen}
        onClose={() => setIsTxModalOpen(false)}
        title={txSource === 'ai_parsed' ? 'Konfirmasi Hasil Smart Parse AI' : 'Catat Transaksi Cepat'}
      >
        <form onSubmit={handleAddTransaction} className="space-y-4">
          {txSource === 'ai_parsed' && (
            <div className="rounded-xl bg-violet-50 border border-violet-200 px-3.5 py-2.5 text-xs text-violet-800 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600 shrink-0" />
              Data transaksi berhasil diekstrak oleh AI. Silakan periksa sebelum menyimpan.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setTxType('expense')}
              className={`py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                txType === 'expense'
                  ? 'bg-white text-rose-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => setTxType('income')}
              className={`py-2 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                txType === 'income'
                  ? 'bg-white text-emerald-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Pemasukan
            </button>
          </div>

          <div>
            <label
              htmlFor="tx-amount-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Nominal (Rp)
            </label>
            <span id="tx-amount-hint" className="field-hint">
              Masukkan angka bulat Rupiah tanpa titik (minimal Rp1)
            </span>
            <input
              id="tx-amount-input"
              type="number"
              required
              min="1"
              value={txAmount}
              onChange={(e) => setTxAmount(e.target.value)}
              aria-describedby="tx-amount-hint"
              aria-errormessage="tx-amount-error"
              placeholder="Contoh: 45000"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
              autoFocus
            />
            <div id="tx-amount-error" className="error-msg">
              Nominal transaksi wajib diisi dengan angka positif.
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESET_AMOUNTS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTxAmount(String(preset))}
                  className="rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors cursor-pointer"
                >
                  +{preset / 1000}rb
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Kategori
              </label>
              <select
                value={txCategoryId}
                onChange={(e) => setTxCategoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
              >
                {categories
                  .filter((c) => c.type === txType)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Dompet / Sumber Dana
              </label>
              <select
                value={txWalletId}
                onChange={(e) => setTxWalletId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Merchant / Tempat (Opsional)
              </label>
              <input
                type="text"
                value={txMerchant}
                onChange={(e) => setTxMerchant(e.target.value)}
                placeholder="Kopi Janji Jiwa, GoRide..."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Tanggal
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Catatan / Deskripsi
            </label>
            <input
              type="text"
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder="Makan siang kantor..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-semibold text-white shadow-md transition-colors cursor-pointer"
          >
            Simpan Transaksi
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 2: SMART PARSING & AUTO-CATEGORIZATION AI (PHASE 2) */}
      <ModalDialog
        isOpen={isSmartParseModalOpen}
        onClose={() => setIsSmartParseModalOpen(false)}
        title="Smart Parsing Mutasi & Notifikasi (AI)"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Tempelkan (*paste*) teks notifikasi bank atau e-wallet (QRIS, GoPay, ShopeePay, OVO,
            BCA, Mandiri). AI akan mengekstrak nominal, merchant, dan kategori secara otomatis.
          </p>

          <form onSubmit={handleRunSmartParse} className="space-y-3">
            <textarea
              rows={3}
              required
              value={rawMutationText}
              onChange={(e) => setRawMutationText(e.target.value)}
              placeholder="Contoh: QRIS Rp45.000 at Kopi Janji Jiwa berhasil..."
              className="w-full rounded-xl border border-slate-200 p-3.5 text-sm focus:border-violet-500 focus:outline-none"
            />

            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Coba Contoh Teks Notifikasi (Klik untuk mengisi):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SAMPLE_MUTATIONS.map((sample, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setRawMutationText(sample)}
                    className="text-left rounded-lg bg-slate-100 hover:bg-violet-50 hover:text-violet-700 px-2.5 py-1 text-[11px] text-slate-600 transition-colors cursor-pointer truncate max-w-full"
                  >
                    {sample.slice(0, 48)}...
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isParsingAi || !rawMutationText.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 py-3 text-sm font-semibold text-white shadow-md transition-colors cursor-pointer"
            >
              <Wand2 className="h-4 w-4" />
              {isParsingAi ? 'Mengekstrak dengan AI...' : 'Ekstrak Otomatis dengan AI'}
            </button>
          </form>

          {parseError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {parseError}
            </div>
          )}

          {parsedPreview && (
            <div className="rounded-2xl bg-violet-50/70 border border-violet-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-violet-800 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                  Hasil Ekstraksi AI
                </span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  Akurasi {Math.round(parsedPreview.confidence * 100)}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-violet-100">
                  <span className="text-slate-400 block">Nominal</span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {formatIDR(parsedPreview.amount)}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-violet-100">
                  <span className="text-slate-400 block">Kategori Otomatis</span>
                  <span className="text-sm font-bold text-violet-700">
                    {parsedPreview.category_name}
                  </span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-violet-100">
                  <span className="text-slate-400 block">Merchant</span>
                  <span className="font-semibold text-slate-800">{parsedPreview.merchant}</span>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-violet-100">
                  <span className="text-slate-400 block">Jenis Transaksi</span>
                  <span
                    className={`font-bold uppercase ${
                      parsedPreview.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {parsedPreview.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleApplyParsedResult}
                className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Lanjutkan & Simpan Transaksi &rarr;
              </button>
            </div>
          )}
        </div>
      </ModalDialog>

      {/* MODAL 3: SMART BUDGETING ENVELOPE SETTING (PHASE 3) */}
      <ModalDialog
        isOpen={isBudgetModalOpen}
        onClose={() => setIsBudgetModalOpen(false)}
        title="Atur Amplop & Rincian Anggaran"
      >
        <form onSubmit={handleSaveBudget} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Pilih Kategori Pengeluaran
            </label>
            <select
              value={budgetCatId}
              onChange={(e) => {
                const nextCatId = e.target.value;
                const existing = budgets.find((b) => b.category_id === nextCatId);
                const existingItems = existing?.items || [];
                const itemsSum = existingItems.reduce((s, i) => s + Number(i.amount || 0), 0);
                setBudgetCatId(nextCatId);
                setBudgetDraftItems(existingItems);
                setBudgetLimitInput(
                  String(existingItems.length > 0 ? itemsSum : existing?.amount_limit || 1500000)
                );
                setBudgetThresholdInput(String(existing?.alert_threshold || 80));
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
            >
              {categories
                .filter((c) => c.type === 'expense')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* RINCIAN POIN ANGGARAN DI DALAM MODAL */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Rincian Poin Anggaran ({budgetDraftItems.length} Poin)
              </span>
              {budgetDraftItems.length > 0 && (
                <span className="text-xs font-extrabold text-indigo-700">
                  Total:{' '}
                  {formatIDR(budgetDraftItems.reduce((sum, item) => sum + item.amount, 0))}
                </span>
              )}
            </div>

            {budgetDraftItems.length > 0 && (
              <div className="divide-y divide-slate-200/70 rounded-lg bg-white border border-slate-200/80 max-h-44 overflow-y-auto">
                {budgetDraftItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-slate-800">{item.label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-slate-900">{formatIDR(item.amount)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDraftBudgetItem(item.id)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                        title="Hapus poin"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={draftItemLabel}
                onChange={(e) => setDraftItemLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddDraftBudgetItem();
                  }
                }}
                placeholder="Nama poin (contoh: Listrik PLN)"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1000"
                  value={draftItemAmount}
                  onChange={(e) => setDraftItemAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddDraftBudgetItem();
                    }
                  }}
                  placeholder="Nominal (Rp)"
                  className="w-full sm:w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddDraftBudgetItem}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-slate-900 hover:bg-slate-800 px-3 py-2 text-xs font-semibold text-white cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Poin
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="budget-limit-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Batas Anggaran Bulanan (Rp)
              </label>
              {budgetDraftItems.length > 0 && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                  Otomatis dari Total Poin
                </span>
              )}
            </div>
            <span id="budget-limit-hint" className="field-hint">
              {budgetDraftItems.length > 0
                ? 'Otomatis menjumlahkan seluruh poin rincian di atas'
                : 'Masukkan kuota maksimal bulan ini (contoh: 2000000)'}
            </span>
            <input
              id="budget-limit-input"
              type="number"
              required
              min="1000"
              readOnly={budgetDraftItems.length > 0}
              value={
                budgetDraftItems.length > 0
                  ? String(budgetDraftItems.reduce((sum, item) => sum + item.amount, 0))
                  : budgetLimitInput
              }
              onChange={(e) => setBudgetLimitInput(e.target.value)}
              aria-describedby="budget-limit-hint"
              aria-errormessage="budget-limit-error"
              className={`w-full rounded-xl border border-slate-200 px-4 py-2.5 text-base font-bold text-slate-900 focus:border-indigo-500 focus:outline-none ${
                budgetDraftItems.length > 0 ? 'bg-slate-100 cursor-not-allowed' : ''
              }`}
            />
            <div id="budget-limit-error" className="error-msg">
              Masukkan nominal batas anggaran minimal Rp1.000.
            </div>
          </div>

          <div>
            <label
              htmlFor="budget-threshold-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Ambang Peringatan Proaktif (%)
            </label>
            <span id="budget-threshold-hint" className="field-hint">
              Tampilkan peringatan saat pemakaian mencapai persentase ini (10% - 100%)
            </span>
            <input
              id="budget-threshold-input"
              type="number"
              required
              min="10"
              max="100"
              value={budgetThresholdInput}
              onChange={(e) => setBudgetThresholdInput(e.target.value)}
              aria-describedby="budget-threshold-hint"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-semibold text-white shadow-md cursor-pointer"
          >
            Simpan Alokasi Anggaran{' '}
            {formatIDR(
              budgetDraftItems.length > 0
                ? budgetDraftItems.reduce((sum, item) => sum + item.amount, 0)
                : Number(budgetLimitInput) || 0
            )}
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 4: ADD CUSTOM CATEGORY */}
      <ModalDialog
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        title="Tambah Kategori Kustom"
      >
        <form onSubmit={handleAddCategory} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Nama Kategori
            </label>
            <input
              type="text"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Contoh: Langganan Streaming, Olahraga..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Jenis Kategori
            </label>
            <select
              value={catType}
              onChange={(e) => setCatType(e.target.value as TransactionType)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white"
            >
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Warna Label
            </label>
            <div className="flex gap-2.5">
              {COLOR_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setCatColor(hex)}
                  className={`h-8 w-8 rounded-full transition-transform cursor-pointer ${
                    catColor === hex ? 'scale-110 ring-2 ring-offset-2 ring-slate-900' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 py-3 text-sm font-semibold text-white cursor-pointer"
          >
            Simpan Kategori
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 5: ADD WALLET */}
      <ModalDialog
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        title="Tambah Kantong / Dompet"
      >
        <form onSubmit={handleAddWallet} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Nama Dompet / Rekening
            </label>
            <input
              type="text"
              required
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              placeholder="Contoh: Bank Mandiri, OVO, ShopeePay..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Tipe
              </label>
              <select
                value={walletType}
                onChange={(e) => setWalletType(e.target.value as WalletType)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white"
              >
                <option value="bank">Rekening Bank</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Uang Tunai</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Saldo Awal (Rp)
              </label>
              <input
                type="number"
                value={walletInitialBalance}
                onChange={(e) => setWalletInitialBalance(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Warna Identitas
            </label>
            <div className="flex gap-2.5">
              {COLOR_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setWalletColor(hex)}
                  className={`h-8 w-8 rounded-full transition-transform cursor-pointer ${
                    walletColor === hex ? 'scale-110 ring-2 ring-offset-2 ring-slate-900' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 py-3 text-sm font-semibold text-white cursor-pointer"
          >
            Tambah Dompet
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 6: SUPABASE AUTH / CLOUD SYNC */}
      <ModalDialog
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        title="Sinkronisasi Cloud Supabase"
      >
        {isSupabaseConfigured ? (
          <form onSubmit={handleSupabaseAuth} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className={`py-2 text-xs font-semibold rounded-lg cursor-pointer ${
                  authMode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Masuk (Login)
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`py-2 text-xs font-semibold rounded-lg cursor-pointer ${
                  authMode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                Daftar Akun
              </button>
            </div>

            {authMessage && (
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3 text-xs text-indigo-800">
                {authMessage}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-semibold text-white cursor-pointer"
            >
              {authLoading
                ? 'Memproses...'
                : authMode === 'login'
                  ? 'Masuk & Sinkronkan'
                  : 'Buat Akun Baru'}
            </button>
          </form>
        ) : (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Saat ini aplikasi berjalan dalam <strong>Mode Offline-First (LocalStorage)</strong>.
              Seluruh perubahan Anda tersimpan otomatis di perangkat ini.
            </p>
            <p className="text-xs bg-slate-100 p-3 rounded-xl font-mono text-slate-700">
              Untuk mengaktifkan sinkronisasi Cloud Supabase:
              <br />
              1. Jalankan script <strong>supabase/schema.sql</strong> di SQL Editor Supabase.
              <br />
              2. Salin <strong>.env.example</strong> menjadi <strong>.env</strong> dan isi{' '}
              <code>VITE_SUPABASE_URL</code> serta <code>VITE_SUPABASE_ANON_KEY</code>.
            </p>
          </div>
        )}
      </ModalDialog>

      {/* MODAL 7: GEMINI API KEY SETTINGS */}
      <ModalDialog
        isOpen={isAiKeyModalOpen}
        onClose={() => setIsAiKeyModalOpen(false)}
        title="Konfigurasi Engine Gemini AI"
      >
        <form onSubmit={handleSaveGeminiKey} className="space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">Arsitektur Keamanan Production:</p>
            <p>
              Untuk produksi, simpan <code>GEMINI_API_KEY</code> di{' '}
              <strong>Supabase Edge Functions Secrets</strong> (file tersedia di{' '}
              <code>supabase/functions/ai-parse</code> &amp; <code>ai-advisor</code>).
            </p>
            <p>
              Untuk pengujian lokal langsung di browser menggunakan{' '}
              <code>@google/genai (gemini-3.8-flash)</code>, Anda dapat memasukkan API Key di bawah
              ini (atau kosongkan untuk menggunakan simulator AI pintar bawaan).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Gemini API Key (Opsional - Local Dev)
            </label>
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-semibold text-white cursor-pointer"
          >
            Simpan Konfigurasi AI
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 8: ADD DEBT OR RECEIVABLE (KOMITMEN HUTANG & PIUTANG) */}
      <ModalDialog
        isOpen={isDebtModalOpen}
        onClose={() => setIsDebtModalOpen(false)}
        title="Catat Komitmen Hutang / Piutang"
      >
        <form onSubmit={handleAddDebt} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setDebtDirection('payable')}
              className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                debtDirection === 'payable'
                  ? 'bg-white text-rose-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Hutang / Cicilan Saya
            </button>
            <button
              type="button"
              onClick={() => setDebtDirection('receivable')}
              className={`py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                debtDirection === 'receivable'
                  ? 'bg-white text-emerald-600 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Piutang (Dipinjam Orang)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="debt-title-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
              >
                Nama Tagihan / Keperluan
              </label>
              <input
                id="debt-title-input"
                type="text"
                required
                value={debtTitle}
                onChange={(e) => setDebtTitle(e.target.value)}
                placeholder={
                  debtDirection === 'payable'
                    ? 'Contoh: Cicilan Laptop, KPR...'
                    : 'Contoh: Pinjaman Dana Darurat...'
                }
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="debt-counterparty-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
              >
                {debtDirection === 'payable' ? 'Kreditur / Platform' : 'Nama Peminjam'}
              </label>
              <input
                id="debt-counterparty-input"
                type="text"
                required
                value={debtCounterparty}
                onChange={(e) => setDebtCounterparty(e.target.value)}
                placeholder={
                  debtDirection === 'payable'
                    ? 'ShopeePayLater, BCA, Kredivo...'
                    : 'Andi, Budi, Kantor...'
                }
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="debt-total-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Total Pokok (Rp)
              </label>
              <span id="debt-total-hint" className="field-hint">
                Total keseluruhan {debtDirection === 'payable' ? 'hutang' : 'piutang'}
              </span>
              <input
                id="debt-total-input"
                type="number"
                required
                min="1000"
                value={debtTotalInput}
                onChange={(e) => {
                  setDebtTotalInput(e.target.value);
                  if (!debtInstallmentInput) setDebtInstallmentInput(e.target.value);
                }}
                aria-describedby="debt-total-hint"
                aria-errormessage="debt-total-error"
                placeholder="Contoh: 3000000"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              <div id="debt-total-error" className="error-msg">
                Masukkan nominal pokok minimal Rp1.000.
              </div>
            </div>

            <div>
              <label
                htmlFor="debt-installment-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Cicilan / Tagihan per Bulan (Rp)
              </label>
              <span id="debt-installment-hint" className="field-hint">
                Isi sama dengan total jika sekali bayar
              </span>
              <input
                id="debt-installment-input"
                type="number"
                required
                min="1000"
                value={debtInstallmentInput}
                onChange={(e) => setDebtInstallmentInput(e.target.value)}
                aria-describedby="debt-installment-hint"
                placeholder="Contoh: 500000"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="debt-dueday-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
              >
                Tanggal Jatuh Tempo (1 - 31)
              </label>
              <input
                id="debt-dueday-input"
                type="number"
                required
                min="1"
                max="31"
                value={debtDueDayInput}
                onChange={(e) => setDebtDueDayInput(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="debt-notes-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
              >
                Catatan Tenor / Bunga (Opsional)
              </label>
              <input
                id="debt-notes-input"
                type="text"
                value={debtNotesInput}
                onChange={(e) => setDebtNotesInput(e.target.value)}
                placeholder="Cicilan 6x 0%, Jatuh tempo gajian..."
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-2.5">
            <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={debtSyncInitialWallet}
                onChange={(e) => setDebtSyncInitialWallet(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>
                {debtDirection === 'payable'
                  ? 'Dana pinjaman baru cair ke Kantong saya sekarang (Tambah Saldo)'
                  : 'Uang baru dipinjamkan dari Kantong saya sekarang (Potong Saldo)'}
              </span>
            </label>

            {debtSyncInitialWallet && (
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                  Pilih Kantong Terkait
                </label>
                <select
                  value={debtInitialWalletId}
                  onChange={(e) => setDebtInitialWalletId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs bg-white"
                >
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} (Saldo: {formatIDR(walletBalances[w.id] || 0)})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <button
            type="submit"
            className={`w-full rounded-xl py-3 text-sm font-semibold text-white shadow-md transition-colors cursor-pointer ${
              debtDirection === 'payable'
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            Simpan {debtDirection === 'payable' ? 'Komitmen Hutang' : 'Catatan Piutang'}
          </button>
        </form>
      </ModalDialog>

      {/* MODAL 9: SETTLE / PAY INSTALLMENT INTEGRATED WITH WALLET */}
      <ModalDialog
        isOpen={isDebtPayModalOpen}
        onClose={() => {
          setIsDebtPayModalOpen(false);
          setSelectedDebtForPay(null);
        }}
        title={
          selectedDebtForPay?.direction === 'payable'
            ? 'Bayar Cicilan / Lunasi Hutang'
            : 'Terima Pelunasan Piutang'
        }
      >
        {selectedDebtForPay && (
          <form onSubmit={handleSettleDebtInstallment} className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">{selectedDebtForPay.title}</span>
                <span className="text-slate-500">{selectedDebtForPay.counterparty}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-slate-500">Sisa Kewajiban Saat Ini:</span>
                <strong className="text-rose-600">
                  {formatIDR(selectedDebtForPay.remaining_amount)}
                </strong>
              </div>
            </div>

            <div>
              <label
                htmlFor="debt-pay-amount-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Nominal {selectedDebtForPay.direction === 'payable' ? 'Pembayaran' : 'Pelunasan'} (Rp)
              </label>
              <span id="debt-pay-amount-hint" className="field-hint">
                Otomatis memotong sisa pokok & mencatat transaksi di riwayat
              </span>
              <input
                id="debt-pay-amount-input"
                type="number"
                required
                min="1"
                max={selectedDebtForPay.remaining_amount}
                value={debtPayAmountInput}
                onChange={(e) => setDebtPayAmountInput(e.target.value)}
                aria-describedby="debt-pay-amount-hint"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-base font-bold text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() =>
                    setDebtPayAmountInput(
                      String(
                        Math.min(
                          selectedDebtForPay.monthly_installment,
                          selectedDebtForPay.remaining_amount
                        )
                      )
                    )
                  }
                  className="rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cicilan Bulan Ini (
                  {formatIDR(
                    Math.min(
                      selectedDebtForPay.monthly_installment,
                      selectedDebtForPay.remaining_amount
                    )
                  )}
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setDebtPayAmountInput(String(selectedDebtForPay.remaining_amount))}
                  className="rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 px-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Lunasi Penuh ({formatIDR(selectedDebtForPay.remaining_amount)})
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="debt-pay-wallet-select"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5"
              >
                {selectedDebtForPay.direction === 'payable'
                  ? 'Potong Saldo dari Kantong / Dompet'
                  : 'Masukkan Dana ke Kantong / Dompet'}
              </label>
              <select
                id="debt-pay-wallet-select"
                value={debtPayWalletId}
                onChange={(e) => setDebtPayWalletId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm bg-white focus:border-indigo-500 focus:outline-none"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} — Saldo: {formatIDR(walletBalances[w.id] || 0)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className={`w-full rounded-xl py-3 text-sm font-semibold text-white shadow-md transition-colors cursor-pointer ${
                selectedDebtForPay.direction === 'payable'
                  ? 'bg-indigo-600 hover:bg-indigo-500'
                  : 'bg-emerald-600 hover:bg-emerald-500'
              }`}
            >
              {selectedDebtForPay.direction === 'payable'
                ? `Bayar Cicilan ${formatIDR(Number(debtPayAmountInput) || 0)}`
                : `Terima Pelunasan ${formatIDR(Number(debtPayAmountInput) || 0)}`}
            </button>
          </form>
        )}
      </ModalDialog>

      {/* MODAL 10: FORMAL CONFIRMATION DIALOG BOX FOR DELETE & RESET */}
      <ModalDialog
        isOpen={Boolean(confirmDialog)}
        onClose={() => setConfirmDialog(null)}
        closedBy="closerequest"
        title={confirmDialog?.title || 'Konfirmasi Tindakan'}
      >
        {confirmDialog && (
          <div className="space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-200/80 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                  {confirmDialog.message}
                </p>
                {confirmDialog.detail && (
                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2 font-medium leading-relaxed">
                    {confirmDialog.detail}
                  </p>
                )}
                <p className="text-[11px] text-slate-400">
                  Tindakan yang telah dikonfirmasi tidak dapat dibatalkan secara otomatis.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="w-full rounded-xl bg-slate-100 hover:bg-slate-200/80 py-2.5 px-4 text-xs sm:text-sm font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                Batalkan
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className="w-full rounded-xl bg-rose-600 hover:bg-rose-500 py-2.5 px-4 text-xs sm:text-sm font-semibold text-white shadow-sm transition-colors cursor-pointer"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </ModalDialog>
    </div>
  );
}

