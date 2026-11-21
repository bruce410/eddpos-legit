export const SUPER_ADMIN_EMAIL = 'brucemacharia552@gmail.com';

export type UserRole = 'admin' | 'sales';

export type BillingCycle = 'monthly' | 'quarterly' | 'annual' | 'one-time';

export type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'suspended' | 'unassigned';

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface UserProfile {
  id: string;
  user: string;
  email: string;
  role: UserRole;
  orgId: string;
  createdBy?: string;
  createdAt?: unknown;
}

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail?: string;
  phone?: string;
  planId?: string;
  planName?: string;
  planPrice?: number;
  billingCycle?: BillingCycle;
  subscriptionStatus?: SubscriptionStatus;
  subscriptionStartDate?: string;
  subscriptionExpiryDate?: string;
  lastPaymentRef?: string;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  billingNotes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PaymentPlan {
  id: string;
  name: string;
  code: string;
  description: string;
  price: number;
  setupFee?: number;
  billingCycle: BillingCycle;
  trialDays: number;
  maxUsers: number;
  maxProducts: number;
  features: string[];
  isActive: boolean;
  isRecommended?: boolean;
  createdBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClientPaymentSubmission {
  id: string;
  orgId: string;
  orgName: string;
  submittedBy: string;
  submittedEmail: string;
  planId: string;
  planName: string;
  billingCycle: BillingCycle;
  amount: number;
  paymentMethod: 'M-Pesa' | 'Bank Transfer' | 'Cash' | 'Cheque';
  transactionRef: string;
  notes?: string;
  status: PaymentRequestStatus;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: unknown;
  createdAt?: unknown;
}

export interface Product {
  id: string;
  name: string;
  buy: number;
  sell: number;
  stock: number;
  lowStockThreshold: number;
  orgId: string;
  createdBy?: string;
  createdAt?: unknown;
}

export interface Sale {
  id: string;
  product: string;
  productId: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
  payment: string;
  customer: string;
  soldBy: string;
  orgId: string;
  date: unknown;
  invoiceNo?: string;
}

export interface Purchase {
  id: string;
  product: string;
  productId: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  supplier: string;
  note?: string;
  orgId: string;
  recordedBy: string;
  receiptName?: string;
  receiptType?: string;
  receiptData?: string;
  date: unknown;
}

export interface Expense {
  id: string;
  name: string;
  amount: number;
  orgId: string;
  recordedBy: string;
  date: unknown;
}

export interface AlertBanner {
  id: number;
  message: string;
  type: 'success' | 'danger' | 'warning';
}

export type PosTab =
  | 'dashboard'
  | 'products'
  | 'sales'
  | 'dailySales'
  | 'purchases'
  | 'expenses'
  | 'reports'
  | 'users'
  | 'billing';

export interface RolePermissions {
  canAddProducts: boolean;
  canEditProducts: boolean;
  canDeleteProducts: boolean;
  canAddPurchases: boolean;
  canViewPurchases: boolean;
  canAddExpenses: boolean;
  canDeleteExpenses: boolean;
  canDeleteSales: boolean;
  canViewReports: boolean;
  canExportCSV: boolean;
  canViewAnnualReport: boolean;
  canManageUsers: boolean;
  canViewBuyingPrice: boolean;
  canManageBilling: boolean;
  tabs: PosTab[];
}

export const PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    canAddProducts: true,
    canEditProducts: true,
    canDeleteProducts: true,
    canAddPurchases: true,
    canViewPurchases: true,
    canAddExpenses: true,
    canDeleteExpenses: true,
    canDeleteSales: true,
    canViewReports: true,
    canExportCSV: true,
    canViewAnnualReport: true,
    canManageUsers: true,
    canViewBuyingPrice: true,
    canManageBilling: true,
    tabs: ['dashboard', 'products', 'sales', 'dailySales', 'purchases', 'expenses', 'reports', 'users', 'billing'],
  },
  sales: {
    canAddProducts: false,
    canEditProducts: false,
    canDeleteProducts: false,
    canAddPurchases: true,
    canViewPurchases: true,
    canAddExpenses: false,
    canDeleteExpenses: false,
    canDeleteSales: false,
    canViewReports: false,
    canExportCSV: false,
    canViewAnnualReport: false,
    canManageUsers: false,
    canViewBuyingPrice: false,
    canManageBilling: false,
    tabs: ['products', 'sales', 'dailySales', 'purchases', 'reports'],
  },
};
