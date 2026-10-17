export type TransactionType = 'income' | 'expense';
export type WalletType = 'cash' | 'bank' | 'ewallet';
export type TransactionSource = 'manual' | 'ai_parsed';

export interface Wallet {
  id: string;
  user_id?: string;
  name: string;
  type: WalletType;
  initial_balance: number;
  color: string;
}

export interface Category {
  id: string;
  user_id?: string | null;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
}

export interface Transaction {
  id: string;
  user_id?: string;
  wallet_id: string;
  category_id: string;
  amount: number;
  type: TransactionType;
  merchant?: string;
  description: string;
  transaction_date: string; // YYYY-MM-DD
  source: TransactionSource;
  created_at?: string;
}

export interface BudgetBreakdownItem {
  id: string;
  label: string;
  amount: number;
  is_checked: boolean;
  linked_tx_id?: string | null;
}

export interface Budget {
  id: string;
  user_id?: string;
  category_id: string;
  month: string; // YYYY-MM
  amount_limit: number;
  alert_threshold: number;
  items?: BudgetBreakdownItem[];
}

export type DebtDirection = 'payable' | 'receivable';

export interface DebtItem {
  id: string;
  user_id?: string;
  title: string;
  counterparty: string;
  direction: DebtDirection;
  total_amount: number;
  remaining_amount: number;
  monthly_installment: number;
  due_day: number; // 1 - 31
  last_paid_month?: string | null; // YYYY-MM
  notes?: string;
  created_at?: string;
}


