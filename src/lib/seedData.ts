import { Budget, Category, DebtItem, Transaction, Wallet } from '../types/finance';

export const DEFAULT_WALLETS: Wallet[] = [
  {
    id: 'w-bca',
    name: 'Bank BCA',
    type: 'bank',
    initial_balance: 8500000,
    color: '#4f46e5'
  },
  {
    id: 'w-gopay',
    name: 'GoPay',
    type: 'ewallet',
    initial_balance: 650000,
    color: '#0ea5e9'
  },
  {
    id: 'w-cash',
    name: 'Dompet Tunai',
    type: 'cash',
    initial_balance: 450000,
    color: '#10b981'
  }
];

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-food', user_id: null, name: 'Makan & Minum', icon: 'Utensils', color: '#f97316', type: 'expense' },
  { id: 'cat-transport', user_id: null, name: 'Transportasi', icon: 'Car', color: '#3b82f6', type: 'expense' },
  { id: 'cat-shopping', user_id: null, name: 'Belanja', icon: 'ShoppingBag', color: '#ec4899', type: 'expense' },
  { id: 'cat-bills', user_id: null, name: 'Tagihan & Utilitas', icon: 'Receipt', color: '#eab308', type: 'expense' },
  { id: 'cat-debt', user_id: null, name: 'Cicilan & Hutang', icon: 'CreditCard', color: '#e11d48', type: 'expense' },
  { id: 'cat-entertainment', user_id: null, name: 'Hiburan', icon: 'Film', color: '#8b5cf6', type: 'expense' },
  { id: 'cat-savings', user_id: null, name: 'Tabungan & Investasi', icon: 'PiggyBank', color: '#14b8a6', type: 'expense' },
  { id: 'cat-salary', user_id: null, name: 'Gaji Bulanan', icon: 'Wallet', color: '#10b981', type: 'income' },
  { id: 'cat-freelance', user_id: null, name: 'Bonus & Freelance', icon: 'Sparkles', color: '#06b6d4', type: 'income' },
  { id: 'cat-receivable', user_id: null, name: 'Pelunasan Piutang', icon: 'HandCoins', color: '#22c55e', type: 'income' }
];

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

export const DEFAULT_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    wallet_id: 'w-bca',
    category_id: 'cat-salary',
    amount: 12000000,
    type: 'income',
    merchant: 'PT Teknologi Nusantara',
    description: 'Gaji Bulan Berjalan',
    transaction_date: `${currentMonth}-01`,
    source: 'manual'
  },
  {
    id: 'tx-2',
    wallet_id: 'w-gopay',
    category_id: 'cat-food',
    amount: 45000,
    type: 'expense',
    merchant: 'Kopi Janji Jiwa',
    description: 'Es Kopi Susu & Toast',
    transaction_date: today,
    source: 'ai_parsed'
  },
  {
    id: 'tx-3',
    wallet_id: 'w-gopay',
    category_id: 'cat-transport',
    amount: 32000,
    type: 'expense',
    merchant: 'GoRide',
    description: 'Perjalanan ke Kantor Sudirman',
    transaction_date: today,
    source: 'manual'
  },
  {
    id: 'tx-4',
    wallet_id: 'w-bca',
    category_id: 'cat-bills',
    amount: 685000,
    type: 'expense',
    merchant: 'PLN & Biznet Home',
    description: 'Token Listrik & WiFi Bulanan',
    transaction_date: `${currentMonth}-05`,
    source: 'manual'
  },
  {
    id: 'tx-5',
    wallet_id: 'w-bca',
    category_id: 'cat-shopping',
    amount: 420000,
    type: 'expense',
    merchant: 'Superindo',
    description: 'Belanja Bulanan Groceries',
    transaction_date: `${currentMonth}-08`,
    source: 'manual'
  },
  {
    id: 'tx-6',
    wallet_id: 'w-cash',
    category_id: 'cat-food',
    amount: 185000,
    type: 'expense',
    merchant: 'Sate Khas Senayan',
    description: 'Makan Malam Akhir Pekan',
    transaction_date: `${currentMonth}-10`,
    source: 'manual'
  }
];

export const DEFAULT_BUDGETS: Budget[] = [
  {
    id: 'b-food',
    category_id: 'cat-food',
    month: currentMonth,
    amount_limit: 2000000,
    alert_threshold: 80,
    items: [
      { id: 'bi-food-1', label: 'Belanja Bahan Masak & Groceries', amount: 950000, is_checked: false },
      { id: 'bi-food-2', label: 'Makan Siang & Harian Kerja', amount: 700000, is_checked: false },
      { id: 'bi-food-3', label: 'Kopi & Kuliner Akhir Pekan', amount: 350000, is_checked: false }
    ]
  },
  {
    id: 'b-transport',
    category_id: 'cat-transport',
    month: currentMonth,
    amount_limit: 800000,
    alert_threshold: 80,
    items: [
      { id: 'bi-trans-1', label: 'BBM / Bensin Bulanan', amount: 450000, is_checked: false },
      { id: 'bi-trans-2', label: 'Ojek Online / KRL & Parkir', amount: 250000, is_checked: false },
      { id: 'bi-trans-3', label: 'Cadangan Tol & Servis Ringan', amount: 100000, is_checked: false }
    ]
  },
  {
    id: 'b-shopping',
    category_id: 'cat-shopping',
    month: currentMonth,
    amount_limit: 1500000,
    alert_threshold: 80,
    items: [
      { id: 'bi-shop-1', label: 'Kebutuhan Rumah & Toiletries', amount: 600000, is_checked: false },
      { id: 'bi-shop-2', label: 'Kebutuhan Pribadi & Skincare', amount: 500000, is_checked: false },
      { id: 'bi-shop-3', label: 'Dana Belanja Insidental', amount: 400000, is_checked: false }
    ]
  },
  {
    id: 'b-bills',
    category_id: 'cat-bills',
    month: currentMonth,
    amount_limit: 1000000,
    alert_threshold: 80,
    items: [
      { id: 'bi-bill-1', label: 'Token Listrik PLN', amount: 450000, is_checked: false },
      { id: 'bi-bill-2', label: 'WiFi Internet Rumah (Biznet)', amount: 375000, is_checked: false },
      { id: 'bi-bill-3', label: 'Paket Data Seluler & Air', amount: 175000, is_checked: false }
    ]
  }
];

export const DEFAULT_DEBTS: DebtItem[] = [
  {
    id: 'debt-spaylater',
    title: 'Cicilan Monitor Kerja 4K',
    counterparty: 'ShopeePayLater',
    direction: 'payable',
    total_amount: 4500000,
    remaining_amount: 2250000,
    monthly_installment: 750000,
    due_day: Math.min(new Date().getDate() + 2, 28),
    last_paid_month: null,
    notes: 'Cicilan 6x bunga 0% (Sisa 3x)'
  },
  {
    id: 'debt-cc-bca',
    title: 'Tagihan Kartu Kredit BCA',
    counterparty: 'BCA Everyday Card',
    direction: 'payable',
    total_amount: 1800000,
    remaining_amount: 600000,
    monthly_installment: 600000,
    due_day: 25,
    last_paid_month: null,
    notes: 'Cicilan servis berkala kendaraan'
  },
  {
    id: 'debt-piutang-andi',
    title: 'Pinjaman Dana Talangan Tiket',
    counterparty: 'Andi Pratama',
    direction: 'receivable',
    total_amount: 1000000,
    remaining_amount: 500000,
    monthly_installment: 500000,
    due_day: 20,
    last_paid_month: null,
    notes: 'Janji pelunasan saat gajian bulan ini'
  }
];


