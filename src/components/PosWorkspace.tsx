import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  CalendarDays,
  Truck,
  Wallet,
  BarChart3,
  Users,
  CreditCard,
  LogOut,
  Search,
  Printer,
  RotateCcw,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Bell,
  Download,
  ShieldCheck,
  AlertTriangle,
  Check,
  X,
  Menu,
} from 'lucide-react';
import { createSecondaryFirebaseAuth, db, serverTimestamp, toJsDate } from '../lib/firebase';
import {
  escapeHtml,
  formatCurrency,
  formatCycleLabel,
  formatDateTime,
  getTodayIsoDate,
} from '../lib/formatters';
import { ProfitTrendChart } from './ProfitTrendChart';
import {
  PERMISSIONS,
  type ClientPaymentSubmission,
  type Expense,
  type Organization,
  type PaymentPlan,
  type PosTab,
  type Product,
  type Purchase,
  type Sale,
  type UserProfile,
  type UserRole,
} from '../types/pos';

interface PosWorkspaceProps {
  currentUser: UserProfile;
  currentOrg: Organization;
  isSuperAdmin: boolean;
  onSwitchToAdminPortal: () => void;
  onSignOut: () => void;
}

interface InvoiceSale extends Sale {
  invoiceNo: string;
}

export const PosWorkspace: React.FC<PosWorkspaceProps> = ({
  currentUser,
  currentOrg,
  isSuperAdmin,
  onSwitchToAdminPortal,
  onSignOut,
}) => {
  const perms = PERMISSIONS[currentUser.role] || PERMISSIONS.sales;
  const defaultTab: PosTab = perms.tabs.includes('dashboard') ? 'dashboard' : 'sales';
  const [activeTab, setActiveTab] = useState<PosTab>(defaultTab);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Realtime collections
  const [orgState, setOrgState] = useState<Organization>(currentOrg);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [availablePlans, setAvailablePlans] = useState<PaymentPlan[]>([]);
  const [myPayments, setMyPayments] = useState<ClientPaymentSubmission[]>([]);

  const [alert, setAlert] = useState<{ message: string; type: 'success' | 'danger' | 'warning' } | null>(null);

  // Product form
  const [pName, setPName] = useState('');
  const [pBuy, setPBuy] = useState('');
  const [pSell, setPSell] = useState('');
  const [pStock, setPStock] = useState('');
  const [pLowThreshold, setPLowThreshold] = useState('5');
  const [stockSearch, setStockSearch] = useState('');

  // Edit Product modal
  const [editProductTarget, setEditProductTarget] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editBuy, setEditBuy] = useState('');
  const [editSell, setEditSell] = useState('');
  const [editStock, setEditStock] = useState('');

  const actorName = currentUser.user || currentUser.email || 'Staff';

  // Sale form
  const [saleSearch, setSaleSearch] = useState('');
  const [saleProductId, setSaleProductId] = useState('');
  const [saleQty, setSaleQty] = useState('');
  const [saleCustomPrice, setSaleCustomPrice] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('0');
  const [saleCustomer, setSaleCustomer] = useState('');
  const [salePayment, setSalePayment] = useState('Cash');
  const [completingSale, setCompletingSale] = useState(false);
  const [saleFeedback, setSaleFeedback] = useState<{ message: string; type: 'success' | 'danger' | 'warning' } | null>(null);
  const [lastInvoice, setLastInvoice] = useState<InvoiceSale | null>(null);

  // Daily Sales filter
  const [dailySalesDate, setDailySalesDate] = useState(getTodayIsoDate());

  // Purchase form
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseProductId, setPurchaseProductId] = useState('');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState('');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [purchaseReceiptFile, setPurchaseReceiptFile] = useState<File | null>(null);

  // Expense form
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');

  // Report output
  const [reportText, setReportText] = useState('');

  // Staff form
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [showNewStaffPw, setShowNewStaffPw] = useState(false);
  const [newStaffRole, setNewStaffRole] = useState<UserRole>('sales');
  const [creatingStaff, setCreatingStaff] = useState(false);

  // Subscription / Payment Submission Form
  const [payPlanId, setPayPlanId] = useState('');
  const [payMethod, setPayMethod] = useState<'M-Pesa' | 'Bank Transfer' | 'Cash' | 'Cheque'>('M-Pesa');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Confirmation modal
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'danger' | 'warning' = 'success') => {
    setAlert({ message, type });
    setTimeout(() => {
      setAlert((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  // Realtime listeners
  useEffect(() => {
    const orgId = currentUser.orgId;
    if (!orgId) return;

    const unsubOrg = onSnapshot(doc(db, 'organizations', orgId), (snap) => {
      if (snap.exists()) {
        setOrgState({ id: snap.id, ...(snap.data() as Omit<Organization, 'id'>) });
      }
    });

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', orgId)),
      (snap) => {
        const list: Product[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            name: data.name || 'Unnamed product',
            buy: Number(data.buy || 0),
            sell: Number(data.sell || 0),
            stock: Number(data.stock || 0),
            lowStockThreshold: Number.isFinite(data.lowStockThreshold) ? Number(data.lowStockThreshold) : 5,
            orgId: data.orgId,
            createdBy: data.createdBy,
            createdAt: data.createdAt,
          });
        });
        list.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(list);
      }
    );

    const unsubSales = onSnapshot(
      query(collection(db, 'sales'), where('orgId', '==', orgId)),
      (snap) => {
        const list: Sale[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<Sale, 'id'>;
          list.push({
            id: d.id,
            ...data,
            date: data.date ?? new Date(),
          });
        });
        list.sort((a, b) => (toJsDate(b.date)?.getTime() || 0) - (toJsDate(a.date)?.getTime() || 0));
        setSales(list);
      },
      (err) => {
        notify(`Could not load sales: ${err.message}`, 'danger');
      }
    );

    let unsubPurchasesFallback: (() => void) | null = null;
    const unsubPurchases = perms.canViewPurchases
      ? onSnapshot(
          query(collection(db, 'purchases'), where('orgId', '==', orgId), orderBy('date', 'desc'), limit(50)),
          (snap) => {
            const list: Purchase[] = [];
            snap.forEach((d) => {
              const data = d.data() as Omit<Purchase, 'id'>;
              list.push({ id: d.id, ...data, date: data.date ?? new Date() });
            });
            setPurchases(list);
          },
          () => {
            unsubPurchasesFallback = onSnapshot(
              query(collection(db, 'purchases'), where('orgId', '==', orgId)),
              (snap) => {
                const list: Purchase[] = [];
                snap.forEach((d) => {
                  const data = d.data() as Omit<Purchase, 'id'>;
                  list.push({ id: d.id, ...data, date: data.date ?? new Date() });
                });
                list.sort((a, b) => (toJsDate(b.date)?.getTime() || 0) - (toJsDate(a.date)?.getTime() || 0));
                setPurchases(list.slice(0, 50));
              }
            );
          }
        )
      : () => {};

    let unsubExpensesFallback: (() => void) | null = null;
    const unsubExpenses = onSnapshot(
      query(collection(db, 'expenses'), where('orgId', '==', orgId), orderBy('date', 'desc')),
      (snap) => {
        const list: Expense[] = [];
        snap.forEach((d) => {
          const data = d.data() as Omit<Expense, 'id'>;
          list.push({ id: d.id, ...data, date: data.date ?? new Date() });
        });
        setExpenses(list);
      },
      () => {
        unsubExpensesFallback = onSnapshot(
          query(collection(db, 'expenses'), where('orgId', '==', orgId)),
          (snap) => {
            const list: Expense[] = [];
            snap.forEach((d) => {
              const data = d.data() as Omit<Expense, 'id'>;
              list.push({ id: d.id, ...data, date: data.date ?? new Date() });
            });
            list.sort((a, b) => (toJsDate(b.date)?.getTime() || 0) - (toJsDate(a.date)?.getTime() || 0));
            setExpenses(list);
          }
        );
      }
    );

    const unsubPlans = onSnapshot(
      query(collection(db, 'paymentPlans'), orderBy('price', 'asc')),
      (snap) => {
        const list: PaymentPlan[] = [];
        snap.forEach((d) => {
          const p = { id: d.id, ...(d.data() as Omit<PaymentPlan, 'id'>) };
          if (p.isActive !== false) list.push(p);
        });
        setAvailablePlans(list);
        if (list.length > 0) {
          setPayPlanId((prev) => prev || list[0].id);
        }
      },
      () => {}
    );

    const unsubMyPayments = perms.canManageBilling
      ? onSnapshot(
          query(collection(db, 'clientPayments'), where('orgId', '==', orgId)),
          (snap) => {
            const list: ClientPaymentSubmission[] = [];
            snap.forEach((d) =>
              list.push({ id: d.id, ...(d.data() as Omit<ClientPaymentSubmission, 'id'>) })
            );
            list.sort(
              (a, b) => (toJsDate(b.createdAt)?.getTime() || 0) - (toJsDate(a.createdAt)?.getTime() || 0)
            );
            setMyPayments(list);
          },
          () => {}
        )
      : () => {};

    return () => {
      unsubOrg();
      unsubProducts();
      unsubSales();
      unsubPurchases();
      if (unsubPurchasesFallback) unsubPurchasesFallback();
      unsubExpenses();
      if (unsubExpensesFallback) unsubExpensesFallback();
      unsubPlans();
      unsubMyPayments();
    };
  }, [currentUser.orgId, notify, perms.canManageBilling, perms.canViewPurchases]);

  const loadUsers = useCallback(async () => {
    if (!perms.canManageUsers || !currentUser.orgId) return;
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('orgId', '==', currentUser.orgId)));
      const list: UserProfile[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<UserProfile, 'id'>) }));
      setStaffList(list);
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not load staff list.', 'danger');
    }
  }, [currentUser.orgId, notify, perms.canManageUsers]);

  useEffect(() => {
    if (activeTab === 'users' && perms.canManageUsers) {
      loadUsers();
    }
  }, [activeTab, loadUsers, perms.canManageUsers]);

  // Derived Dashboard & Sales Computations
  const todayStr = new Date().toDateString();

  const dashboardStats = useMemo(() => {
    const totalProducts = products.length;
    const stockValue = products.reduce((sum, p) => sum + p.buy * p.stock, 0);
    let todaySales = 0;
    let todayProfit = 0;
    sales.forEach((s) => {
      const d = toJsDate(s.date);
      if (d && d.toDateString() === todayStr) {
        todaySales += Number(s.total || 0);
        todayProfit += Number(s.profit || 0);
      }
    });
    return { totalProducts, stockValue, todaySales, todayProfit };
  }, [products, sales, todayStr]);

  const stockAlerts = useMemo(
    () => products.filter((p) => p.stock <= 0 || p.stock <= p.lowStockThreshold),
    [products]
  );

  const filteredStockProducts = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, stockSearch]);

  const filteredSaleProducts = useMemo(() => {
    const q = saleSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, saleSearch]);

  const filteredPurchaseProducts = useMemo(() => {
    const q = purchaseSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, purchaseSearch]);

  const todaySalesRows = useMemo(() => {
    return sales.filter((s) => {
      const d = toJsDate(s.date);
      return d && d.toDateString() === todayStr;
    });
  }, [sales, todayStr]);

  const todayProductSummary = useMemo(() => {
    const map: Record<string, { qty: number; total: number; payments: Set<string> }> = {};
    let totalQty = 0;
    let totalSales = 0;
    todaySalesRows.forEach((s) => {
      const name = s.product || 'N/A';
      if (!map[name]) map[name] = { qty: 0, total: 0, payments: new Set() };
      map[name].qty += Number(s.qty || 0);
      map[name].total += Number(s.total || 0);
      map[name].payments.add(s.payment || 'Cash');
      totalQty += Number(s.qty || 0);
      totalSales += Number(s.total || 0);
    });
    const rows = Object.keys(map)
      .sort()
      .map((product) => ({
        product,
        qty: map[product].qty,
        avgPrice: map[product].qty > 0 ? map[product].total / map[product].qty : 0,
        total: map[product].total,
        payments: Array.from(map[product].payments).join(', '),
      }));
    return { rows, totalQty, totalSales };
  }, [todaySalesRows]);

  const dailySalesData = useMemo(() => {
    const rows = sales
      .map((sale) => ({ sale, date: toJsDate(sale.date) }))
      .filter(({ date }) => date && date.toLocaleDateString('en-CA') === dailySalesDate)
      .sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

    const totalQty = rows.reduce((sum, r) => sum + Number(r.sale.qty || 0), 0);
    const totalSales = rows.reduce((sum, r) => sum + Number(r.sale.total || 0), 0);
    const totalProfit = rows.reduce((sum, r) => sum + Number(r.sale.profit || 0), 0);
    return { rows, totalQty, totalSales, totalProfit };
  }, [sales, dailySalesDate]);

  // Handlers
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.canAddProducts) return;
    const name = pName.trim();
    const buy = parseFloat(pBuy);
    const sell = parseFloat(pSell);
    const stock = parseInt(pStock, 10) || 0;
    const lowStockThreshold = parseInt(pLowThreshold, 10);

    if (!name || Number.isNaN(buy) || Number.isNaN(sell)) {
      notify('Fill in product name, buying price, and selling price.', 'danger');
      return;
    }
    if (sell < buy) {
      notify('Selling price cannot be less than buying price.', 'warning');
      return;
    }

    try {
      await addDoc(collection(db, 'products'), {
        name,
        buy,
        sell,
        stock,
        lowStockThreshold: Number.isNaN(lowStockThreshold) ? 5 : lowStockThreshold,
        orgId: currentUser.orgId,
        createdBy: actorName,
        createdAt: serverTimestamp(),
      });
      setPName('');
      setPBuy('');
      setPSell('');
      setPStock('');
      setPLowThreshold('5');
      notify('Product added!', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not add product.', 'danger');
    }
  };

  const openEditProduct = (p: Product) => {
    setEditProductTarget(p);
    setEditName(p.name);
    setEditBuy(String(p.buy));
    setEditSell(String(p.sell));
    setEditStock(String(p.stock));
  };

  const handleSaveProductEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProductTarget || !perms.canEditProducts) return;
    const name = editName.trim();
    const buy = parseFloat(editBuy);
    const sell = parseFloat(editSell);
    const stock = parseInt(editStock, 10);

    if (!name || Number.isNaN(buy) || Number.isNaN(sell) || Number.isNaN(stock)) {
      notify('Fill in all product fields.', 'danger');
      return;
    }
    if (sell < buy) {
      notify('Selling price cannot be less than buying price.', 'warning');
      return;
    }

    try {
      await updateDoc(doc(db, 'products', editProductTarget.id), {
        name,
        buy,
        sell,
        stock,
        updatedAt: serverTimestamp(),
      });
      setEditProductTarget(null);
      notify('Product updated!', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not update product.', 'danger');
    }
  };

  const handleDeleteProduct = (p: Product) => {
    if (!perms.canDeleteProducts) return;
    setConfirmState({
      message: `Delete product "${p.name}"? This cannot be undone.`,
      onConfirm: async () => {
        await deleteDoc(doc(db, 'products', p.id));
        notify(`Product "${p.name}" deleted.`, 'success');
      },
    });
  };

  const handleCompleteSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (completingSale) return;
    setSaleFeedback(null);

    const resolvedProductId =
      saleProductId || (filteredSaleProducts.length === 1 ? filteredSaleProducts[0].id : '');
    const qty = parseInt(saleQty, 10);

    if (!resolvedProductId) {
      const msg = 'Please select a product from the dropdown before completing the sale.';
      setSaleFeedback({ message: msg, type: 'danger' });
      notify(msg, 'danger');
      return;
    }
    if (Number.isNaN(qty) || qty < 1) {
      const msg = 'Enter a valid quantity (at least 1).';
      setSaleFeedback({ message: msg, type: 'danger' });
      notify(msg, 'danger');
      return;
    }

    setCompletingSale(true);
    try {
      const pRef = doc(db, 'products', resolvedProductId);
      const pSnap = await getDoc(pRef);
      if (!pSnap.exists()) {
        const msg = 'Selected product was not found.';
        setSaleFeedback({ message: msg, type: 'danger' });
        notify(msg, 'danger');
        return;
      }

      const pData = pSnap.data();
      const currentStock = Number(pData.stock ?? 0);
      if (qty > currentStock) {
        const msg = `Not enough stock for "${pData.name}". Available: ${currentStock}`;
        setSaleFeedback({ message: msg, type: 'danger' });
        notify(msg, 'danger');
        return;
      }

      const custom = parseFloat(saleCustomPrice);
      const discount = parseFloat(saleDiscount);
      const safeCustom = Number.isFinite(custom) && custom > 0 ? custom : 0;
      const safeDiscount = Number.isFinite(discount) && discount > 0 ? discount : 0;
      const sellPrice = Number(pData.sell ?? 0) || 0;
      const buyPrice = Number(pData.buy ?? 0) || 0;
      const unitPrice = safeCustom > 0 ? safeCustom : sellPrice;
      const subtotal = unitPrice * qty;
      const total = subtotal - safeDiscount;
      const profit = (unitPrice - buyPrice) * qty - safeDiscount;
      const customer = saleCustomer.trim() || 'Walk-in';
      const invoiceNo = `EDD-${Date.now().toString().slice(-8)}`;

      const salePayload = {
        product: String(pData.name || 'Unnamed product'),
        productId: resolvedProductId,
        qty,
        unitPrice,
        subtotal,
        discount: safeDiscount,
        total,
        profit,
        payment: salePayment || 'Cash',
        customer,
        soldBy: actorName,
        orgId: currentUser.orgId,
        invoiceNo,
        date: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'sales'), salePayload);

      let stockWarning = '';
      try {
        await updateDoc(pRef, { stock: currentStock - qty });
      } catch (stockErr: unknown) {
        const errObj = stockErr as { message?: string };
        stockWarning = ` Sale saved, but stock update was blocked (${errObj.message || 'permission error'}).`;
      }

      const localSale: InvoiceSale = {
        ...salePayload,
        id: docRef.id,
        date: new Date(),
        invoiceNo,
      };
      setLastInvoice(localSale);

      setSales((prev) => {
        if (prev.some((item) => item.id === docRef.id)) return prev;
        return [localSale, ...prev];
      });

      setSaleSearch('');
      setSaleQty('');
      setSaleCustomPrice('');
      setSaleDiscount('0');
      setSaleCustomer('');
      setSaleProductId('');

      if (stockWarning) {
        setSaleFeedback({ message: `Sale recorded.${stockWarning}`, type: 'warning' });
        notify(`Sale recorded.${stockWarning}`, 'warning');
      } else {
        const msg = `Sale recorded: ${qty} × ${salePayload.product} (${formatCurrency(total)})`;
        setSaleFeedback({ message: msg, type: 'success' });
        notify('Sale completed!', 'success');
      }
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      let msg = error.message || 'Could not complete sale.';
      if (error.code === 'permission-denied') {
        msg = 'Firestore permissions blocked saving this sale. Check your Firebase rules for the sales collection.';
      }
      setSaleFeedback({ message: msg, type: 'danger' });
      notify(msg, 'danger');
    } finally {
      setCompletingSale(false);
    }
  };

  const handleDeleteSale = (sale: Sale) => {
    if (!perms.canDeleteSales) return;
    setConfirmState({
      message: `Delete sale of "${sale.product}" (${sale.qty} units)? Stock will be restored.`,
      onConfirm: async () => {
        if (sale.productId && sale.qty > 0) {
          const pRef = doc(db, 'products', sale.productId);
          const pSnap = await getDoc(pRef);
          if (pSnap.exists()) {
            await updateDoc(pRef, { stock: Number(pSnap.data().stock || 0) + Number(sale.qty) });
          }
        }
        await deleteDoc(doc(db, 'sales', sale.id));
        notify('Sale deleted and stock restored.', 'success');
      },
    });
  };

  const handlePrintInvoice = () => {
    if (!lastInvoice) {
      notify('Complete a sale first to generate an invoice.', 'warning');
      return;
    }
    const s = lastInvoice;
    const printHtml = `<!doctype html><html><head><title>Invoice ${escapeHtml(s.invoiceNo)}</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:35px auto;padding:25px;color:#172033}h1{color:#1457c5;margin-bottom:4px}.sub{color:#64748b}table{width:100%;border-collapse:collapse;margin:25px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;font-size:22px;font-weight:bold;color:#1457c5}.thanks{margin-top:35px;border-top:2px solid #e2e8f0;padding-top:15px}</style></head><body><h1>${escapeHtml(orgState.name || 'EDDMOBI ELECTRONICS')}</h1><div class="sub">Kajiado Town · 0722540912</div><h2>SALES INVOICE</h2><p><b>Invoice:</b> ${escapeHtml(s.invoiceNo)}<br><b>Date:</b> ${escapeHtml(formatDateTime(s.date))}<br><b>Customer:</b> ${escapeHtml(s.customer || 'Walk-in')}<br><b>Payment:</b> ${escapeHtml(s.payment || 'Cash')}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody><tr><td>${escapeHtml(s.product)}</td><td>${s.qty}</td><td>${formatCurrency(s.unitPrice)}</td><td>${formatCurrency(s.subtotal)}</td></tr></tbody></table><p>Subtotal: ${formatCurrency(s.subtotal)}</p><p>Discount: ${formatCurrency(s.discount || 0)}</p><p class="total">TOTAL: ${formatCurrency(s.total)}</p><div class="thanks">Thank you for shopping with ${escapeHtml(orgState.name || 'Eddmobi Electronics')}.</div></body></html>`;
    const blob = new Blob([printHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
      }, 1500);
    };
  };

  const handleAddPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.canAddPurchases) return;
    const qty = parseInt(purchaseQty, 10);
    const unitCost = parseFloat(purchaseUnitCost);

    if (!purchaseProductId) {
      notify('Select a product for purchase.', 'danger');
      return;
    }
    if (Number.isNaN(qty) || qty < 1) {
      notify('Enter a valid purchase quantity.', 'danger');
      return;
    }
    if (Number.isNaN(unitCost) || unitCost < 0) {
      notify('Enter a valid buying price.', 'danger');
      return;
    }
    if (purchaseReceiptFile && purchaseReceiptFile.size > 700 * 1024) {
      notify('Receipt must be under 700 KB.', 'warning');
      return;
    }

    try {
      const receiptInfo: Record<string, string> = {};
      if (purchaseReceiptFile) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read receipt file.'));
          reader.readAsDataURL(purchaseReceiptFile);
        });
        receiptInfo.receiptName = purchaseReceiptFile.name;
        receiptInfo.receiptType = purchaseReceiptFile.type || 'application/octet-stream';
        receiptInfo.receiptData = dataUrl;
      }

      const pRef = doc(db, 'products', purchaseProductId);
      const pSnap = await getDoc(pRef);
      if (!pSnap.exists()) throw new Error('Product not found.');
      const pData = pSnap.data();

      await updateDoc(pRef, {
        stock: Number(pData.stock || 0) + qty,
        buy: unitCost,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'purchases'), {
        product: pData.name || 'N/A',
        productId: purchaseProductId,
        qty,
        unitCost,
        totalCost: qty * unitCost,
        supplier: purchaseSupplier.trim() || 'N/A',
        note: purchaseNote.trim(),
        orgId: currentUser.orgId,
        recordedBy: actorName,
        ...receiptInfo,
        date: serverTimestamp(),
      });

      setPurchaseProductId('');
      setPurchaseQty('');
      setPurchaseUnitCost('');
      setPurchaseSupplier('');
      setPurchaseNote('');
      setPurchaseReceiptFile(null);
      notify('Purchase recorded and stock updated!', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not record purchase.', 'danger');
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.canAddExpenses) return;
    const name = expenseName.trim();
    const amount = parseFloat(expenseAmount);
    if (!name) {
      notify('Enter expense description.', 'danger');
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      notify('Enter a valid expense amount.', 'danger');
      return;
    }

    try {
      await addDoc(collection(db, 'expenses'), {
        name,
        amount,
        orgId: currentUser.orgId,
        recordedBy: actorName,
        date: serverTimestamp(),
      });
      setExpenseName('');
      setExpenseAmount('');
      notify('Expense recorded!', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not record expense.', 'danger');
    }
  };

  const handleDeleteExpense = (exp: Expense) => {
    if (!perms.canDeleteExpenses) return;
    setConfirmState({
      message: `Delete expense "${exp.name}" (${formatCurrency(exp.amount)})?`,
      onConfirm: async () => {
        await deleteDoc(doc(db, 'expenses', exp.id));
        notify('Expense deleted.', 'success');
      },
    });
  };

  // Reports
  const generateDailyReport = () => {
    if (!perms.canViewReports) return;
    let totalSales = 0;
    let totalProfit = 0;
    let count = 0;
    sales.forEach((s) => {
      const d = toJsDate(s.date);
      if (d && d.toDateString() === todayStr) {
        totalSales += Number(s.total || 0);
        totalProfit += Number(s.profit || 0);
        count++;
      }
    });
    setReportText(
      `DAILY REPORT - ${new Date().toLocaleDateString('en-KE')}\nOrg: ${orgState.name}\n\nTransactions: ${count}\nTotal Sales: ${formatCurrency(totalSales)}\nProfit: ${formatCurrency(totalProfit)}\n\nBy: ${actorName}`
    );
    notify('Daily report generated.', 'success');
  };

  const generateMonthlyReport = () => {
    if (!perms.canViewReports) return;
    const now = new Date();
    const m = now.getMonth();
    const y = now.getFullYear();
    let totalSales = 0;
    let totalProfit = 0;
    let count = 0;
    sales.forEach((s) => {
      const d = toJsDate(s.date);
      if (d && d.getMonth() === m && d.getFullYear() === y) {
        totalSales += Number(s.total || 0);
        totalProfit += Number(s.profit || 0);
        count++;
      }
    });
    let totalExp = 0;
    expenses.forEach((e) => {
      const d = toJsDate(e.date);
      if (d && d.getMonth() === m && d.getFullYear() === y) {
        totalExp += Number(e.amount || 0);
      }
    });
    const monthName = new Date(y, m).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
    setReportText(
      `MONTHLY REPORT - ${monthName}\nOrg: ${orgState.name}\n\nTransactions: ${count}\nTotal Sales: ${formatCurrency(totalSales)}\nGross Profit: ${formatCurrency(totalProfit)}\nExpenses: ${formatCurrency(totalExp)}\nNET PROFIT: ${formatCurrency(totalProfit - totalExp)}\n\nBy: ${actorName}`
    );
    notify('Monthly report generated.', 'success');
  };

  const generateAnnualReport = () => {
    if (!perms.canViewAnnualReport) return;
    const y = new Date().getFullYear();
    let totalSales = 0;
    let totalProfit = 0;
    let count = 0;
    sales.forEach((s) => {
      const d = toJsDate(s.date);
      if (d && d.getFullYear() === y) {
        totalSales += Number(s.total || 0);
        totalProfit += Number(s.profit || 0);
        count++;
      }
    });
    let totalExp = 0;
    expenses.forEach((e) => {
      const d = toJsDate(e.date);
      if (d && d.getFullYear() === y) {
        totalExp += Number(e.amount || 0);
      }
    });
    setReportText(
      `ANNUAL REPORT - ${y}\nOrg: ${orgState.name}\n\nTransactions: ${count}\nTotal Sales: ${formatCurrency(totalSales)}\nGross Profit: ${formatCurrency(totalProfit)}\nExpenses: ${formatCurrency(totalExp)}\nNET PROFIT: ${formatCurrency(totalProfit - totalExp)}\n\nBy: ${actorName}`
    );
    notify('Annual report generated.', 'success');
  };

  const exportToCSV = () => {
    if (!perms.canExportCSV) return;
    let csv = `EDDMOBI POS - DATA EXPORT\nOrganization: ${orgState.name}\n\nSALES DATA\nDate,Product,Quantity,Unit Price,Subtotal,Discount,Total,Profit,Payment,Customer,Sold By\n`;
    sales.forEach((s) => {
      csv += `"${formatDateTime(s.date)}","${s.product || ''}",${s.qty || 0},${s.unitPrice || 0},${s.subtotal || 0},${s.discount || 0},${s.total || 0},${s.profit || 0},"${s.payment || ''}","${s.customer || ''}","${s.soldBy || ''}"\n`;
    });
    csv += `\nEXPENSE DATA\nDate,Description,Amount,Recorded By\n`;
    expenses.forEach((e) => {
      csv += `"${formatDateTime(e.date)}","${e.name || ''}",${e.amount || 0},"${e.recordedBy || ''}"\n`;
    });
    const el = document.createElement('a');
    el.setAttribute('href', `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`);
    el.setAttribute('download', `eddmobi_export_${Date.now()}.csv`);
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
    notify('Data exported to CSV!', 'success');
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.canManageUsers) return;
    const username = newStaffName.trim().toLowerCase();
    const email = newStaffEmail.trim().toLowerCase();
    if (!username || !email || !newStaffPassword) {
      notify('Please fill in display name, email, and temporary password.', 'danger');
      return;
    }
    if (newStaffPassword.length < 6) {
      notify('Password must be at least 6 characters.', 'warning');
      return;
    }

    setCreatingStaff(true);
    const { secondaryAuth, cleanup } = createSecondaryFirebaseAuth();
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, newStaffPassword);
      await setDoc(doc(db, 'users', cred.user.uid), {
        user: username,
        email,
        role: newStaffRole,
        orgId: currentUser.orgId,
        createdBy: actorName,
        createdAt: serverTimestamp(),
      });
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('');
      notify('Staff account created!', 'success');
      await loadUsers();
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not create staff account.', 'danger');
    } finally {
      await cleanup();
      setCreatingStaff(false);
    }
  };

  const handleSubmitPaymentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenPlan = availablePlans.find((p) => p.id === payPlanId);
    if (!chosenPlan) {
      notify('Select a payment plan first.', 'danger');
      return;
    }
    if (!payRef.trim()) {
      notify('Enter the M-Pesa, bank, or cash receipt reference.', 'danger');
      return;
    }

    setSubmittingPayment(true);
    try {
      await addDoc(collection(db, 'clientPayments'), {
        orgId: currentUser.orgId,
        orgName: orgState.name,
        submittedBy: actorName,
        submittedEmail: currentUser.email,
        planId: chosenPlan.id,
        planName: chosenPlan.name,
        billingCycle: chosenPlan.billingCycle,
        amount: chosenPlan.price,
        paymentMethod: payMethod,
        transactionRef: payRef.trim().toUpperCase(),
        notes: payNotes.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      setPayRef('');
      setPayNotes('');
      notify('Payment confirmation submitted for platform admin approval.', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not submit payment confirmation.', 'danger');
    } finally {
      setSubmittingPayment(false);
    }
  };

  const enableBrowserNotifications = async () => {
    if (!('Notification' in window)) {
      notify('Browser notifications are not supported here. Alerts remain visible on dashboard.', 'warning');
      return;
    }
    const perm = await Notification.requestPermission();
    notify(
      perm === 'granted' ? 'Browser stock notifications enabled.' : 'Notifications not enabled.',
      perm === 'granted' ? 'success' : 'warning'
    );
  };

  const navItems: { id: PosTab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'products', label: 'Products', icon: Package },
    { id: 'sales', label: 'Sales', icon: ShoppingCart },
    { id: 'dailySales', label: 'Daily Sales', icon: CalendarDays },
    { id: 'purchases', label: 'Purchases', icon: Truck },
    { id: 'expenses', label: 'Expenses', icon: Wallet },
    { id: 'reports', label: 'Reports', icon: BarChart3 },
    { id: 'users', label: 'Staff Users', icon: Users },
    { id: 'billing', label: 'Subscription Plan', icon: CreditCard },
  ];

  const visibleNav = navItems.filter((item) => perms.tabs.includes(item.id));

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-slate-950 text-slate-100 flex flex-col justify-between transition-transform duration-200 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
              EDDMOBI POS
            </span>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-white cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-4 py-3.5 border-b border-slate-800/80 space-y-0.5">
            <div className="text-xs font-semibold text-white truncate">{orgState.name}</div>
            <div className="text-xs text-slate-400 truncate">
              {currentUser.user} · {currentUser.role.toUpperCase()}
            </div>
          </div>

          <nav className="p-3 space-y-1" aria-label="POS Navigation">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-800 space-y-1.5">
          {isSuperAdmin && (
            <button
              type="button"
              onClick={onSwitchToAdminPortal}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-blue-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Super Admin Portal</span>
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-red-300 hover:bg-red-950/50 hover:text-red-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Strict 3-zone contract) */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-slate-900 whitespace-nowrap truncate">
              {orgState.name} <span className="text-slate-400 font-normal">/</span>{' '}
              {navItems.find((i) => i.id === activeTab)?.label}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            {perms.tabs.slice(0, 4).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(t)}
                className="hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer capitalize"
              >
                {t === 'dailySales' ? 'Daily Sales' : t}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('sales')}
              className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              New Sale
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="h-10 px-3.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {orgState.subscriptionStatus === 'suspended' && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-sm text-red-900">
                <AlertTriangle className="w-5 h-5 text-red-700 shrink-0" aria-hidden="true" />
                <span>
                  Your business subscription is currently marked <strong>Suspended</strong>. Submit a plan renewal payment or contact 0722540912.
                </span>
              </div>
              {perms.canManageBilling && (
                <button
                  type="button"
                  onClick={() => setActiveTab('billing')}
                  className="px-3.5 py-2 rounded-lg bg-red-700 text-white text-xs font-medium cursor-pointer"
                >
                  Open Subscription Plan
                </button>
              )}
            </div>
          )}

          {alert && (
            <div
              role="alert"
              className={`px-4 py-3 rounded-lg border text-sm flex items-center justify-between ${
                alert.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : alert.type === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <span>{alert.message}</span>
              <button
                type="button"
                onClick={() => setAlert(null)}
                className="p-1 hover:opacity-70 cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Total Products</div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
                    {dashboardStats.totalProducts}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Total Stock Value</div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
                    {formatCurrency(dashboardStats.stockValue)}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Today&apos;s Sales</div>
                  <div className="text-2xl font-bold text-blue-700 font-mono tabular-nums mt-2">
                    {formatCurrency(dashboardStats.todaySales)}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Today&apos;s Profit</div>
                  <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-2">
                    {formatCurrency(dashboardStats.todayProfit)}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Stock Alerts</h2>
                    <p className="text-xs text-slate-500">
                      Products at or below their configured low-stock threshold.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={enableBrowserNotifications}
                    className="h-9 px-3.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Enable browser notifications</span>
                  </button>
                </div>

                {stockAlerts.length === 0 ? (
                  <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                    All products are above their low-stock levels.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {stockAlerts.map((p) => {
                      const out = p.stock <= 0;
                      return (
                        <div key={p.id} className="py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                            <div className={`text-xs ${out ? 'text-red-700' : 'text-amber-700'}`}>
                              {out
                                ? 'Out of stock — restock immediately'
                                : `Low stock — ${p.stock} remaining (alert level ${p.lowStockThreshold})`}
                            </div>
                          </div>
                          <span
                            className={`text-base font-bold font-mono tabular-nums ${
                              out ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            {p.stock}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PRODUCTS */}
          {activeTab === 'products' && (
            <div className="space-y-6">
              {perms.canAddProducts && (
                <form
                  onSubmit={handleAddProduct}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                >
                  <h2 className="text-base font-semibold text-slate-900">Add New Product</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <input
                      value={pName}
                      onChange={(e) => setPName(e.target.value)}
                      placeholder="Product name"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pBuy}
                      onChange={(e) => setPBuy(e.target.value)}
                      placeholder="Buying price (KES)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pSell}
                      onChange={(e) => setPSell(e.target.value)}
                      placeholder="Selling price (KES)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      value={pStock}
                      onChange={(e) => setPStock(e.target.value)}
                      placeholder="Initial stock"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      value={pLowThreshold}
                      onChange={(e) => setPLowThreshold(e.target.value)}
                      placeholder="Low-stock level"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      <span>Add Product</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPName('');
                        setPBuy('');
                        setPSell('');
                        setPStock('');
                        setPLowThreshold('5');
                      }}
                      className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Reset Form</span>
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">Product Stock</h2>
                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input
                      type="search"
                      value={stockSearch}
                      onChange={(e) => setStockSearch(e.target.value)}
                      placeholder="Search products by name..."
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Product Name</th>
                        {perms.canViewBuyingPrice && <th className="py-3 px-4 text-right">Buy</th>}
                        <th className="py-3 px-4 text-right">Sell</th>
                        <th className="py-3 px-4 text-right">Stock</th>
                        {(perms.canEditProducts || perms.canDeleteProducts) && (
                          <th className="py-3 px-4 text-right">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredStockProducts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            {stockSearch ? 'No products match your search.' : 'No products added yet.'}
                          </td>
                        </tr>
                      ) : (
                        filteredStockProducts.map((p) => (
                          <tr key={p.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4 font-medium text-slate-900">{p.name}</td>
                            {perms.canViewBuyingPrice && (
                              <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                                {formatCurrency(p.buy)}
                              </td>
                            )}
                            <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 font-medium">
                              {formatCurrency(p.sell)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums">
                              <span
                                className={
                                  p.stock <= 0
                                    ? 'text-red-700 font-semibold'
                                    : p.stock <= p.lowStockThreshold
                                    ? 'text-amber-700 font-semibold'
                                    : 'text-slate-900'
                                }
                              >
                                {p.stock}
                              </span>
                            </td>
                            {(perms.canEditProducts || perms.canDeleteProducts) && (
                              <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                                {perms.canEditProducts && (
                                  <button
                                    type="button"
                                    onClick={() => openEditProduct(p)}
                                    className="h-8 px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Pencil className="w-3 h-3" aria-hidden="true" />
                                    <span>Edit</span>
                                  </button>
                                )}
                                {perms.canDeleteProducts && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteProduct(p)}
                                    className="h-8 px-2.5 rounded-md border border-red-200 hover:bg-red-50 text-xs font-medium text-red-700 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                                    <span>Delete</span>
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SALES */}
          {activeTab === 'sales' && (
            <div className="space-y-6">
              <form
                onSubmit={handleCompleteSale}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900">Make a Sale</h2>
                  {(() => {
                    const activeProd = products.find(
                      (p) =>
                        p.id ===
                        (saleProductId ||
                          (filteredSaleProducts.length === 1 ? filteredSaleProducts[0].id : ''))
                    );
                    const qNum = parseInt(saleQty, 10) || 0;
                    const customP = parseFloat(saleCustomPrice) || 0;
                    const discP = parseFloat(saleDiscount) || 0;
                    if (!activeProd) return null;
                    const unitP = customP > 0 ? customP : activeProd.sell;
                    const previewTotal = qNum > 0 ? unitP * qNum - discP : unitP;
                    return (
                      <div className="text-xs text-slate-600 font-mono tabular-nums">
                        {activeProd.name} · Stock: {activeProd.stock} ·{' '}
                        <span className="font-semibold text-slate-900">
                          {qNum > 0 ? `Total: ${formatCurrency(previewTotal)}` : `Unit: ${formatCurrency(unitP)}`}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {saleFeedback && (
                  <div
                    role="alert"
                    className={`px-3.5 py-2.5 rounded-lg border text-xs ${
                      saleFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : saleFeedback.type === 'warning'
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-red-50 border-red-200 text-red-800'
                    }`}
                  >
                    {saleFeedback.message}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-5 space-y-2">
                    <input
                      type="text"
                      value={saleSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSaleSearch(val);
                        const matches = products.filter((p) =>
                          p.name.toLowerCase().includes(val.trim().toLowerCase())
                        );
                        if (matches.length === 1) {
                          setSaleProductId(matches[0].id);
                        }
                      }}
                      placeholder="Search product..."
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <select
                      value={saleProductId}
                      onChange={(e) => setSaleProductId(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="">
                        {filteredSaleProducts.length === 0
                          ? 'No matching products'
                          : `Select Product (${filteredSaleProducts.length})`}
                      </option>
                      {filteredSaleProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Stock: {p.stock} · {formatCurrency(p.sell)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="number"
                      min="1"
                      value={saleQty}
                      onChange={(e) => setSaleQty(e.target.value)}
                      placeholder="Quantity"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={saleCustomPrice}
                      onChange={(e) => setSaleCustomPrice(e.target.value)}
                      placeholder="Custom price (optional)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={saleDiscount}
                      onChange={(e) => setSaleDiscount(e.target.value)}
                      placeholder="Discount (KES)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      value={saleCustomer}
                      onChange={(e) => setSaleCustomer(e.target.value)}
                      placeholder="Customer name (optional)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm sm:col-span-2"
                    />
                    <select
                      value={salePayment}
                      onChange={(e) => setSalePayment(e.target.value)}
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option>Cash</option>
                      <option>M-Pesa</option>
                      <option>Cheque</option>
                      <option>Credit</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    disabled={completingSale}
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                  >
                    {completingSale ? 'Recording Sale...' : 'Complete Sale'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaleSearch('');
                      setSaleProductId('');
                      setSaleQty('');
                      setSaleCustomPrice('');
                      setSaleDiscount('0');
                      setSaleCustomer('');
                      setSalePayment('Cash');
                      setSaleFeedback(null);
                    }}
                    className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                  >
                    Reset Form
                  </button>
                </div>
              </form>

              {/* Receipt / Invoice */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">Receipt / Invoice</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrintInvoice}
                      className="h-9 px-3.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Print / Save Invoice</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setLastInvoice(null)}
                      className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      Clear Receipt
                    </button>
                  </div>
                </div>

                <pre className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap">
                  {lastInvoice
                    ? `${orgState.name || 'EDDMOBI ELECTRONICS'}\nSALES RECEIPT / INVOICE\nInvoice No: ${lastInvoice.invoiceNo}\nDate: ${formatDateTime(lastInvoice.date)}\nCustomer: ${lastInvoice.customer || 'Walk-in'}\nSold By: ${lastInvoice.soldBy}\nPayment: ${lastInvoice.payment}\n\nItem: ${lastInvoice.product}\nQuantity: ${lastInvoice.qty} x ${formatCurrency(lastInvoice.unitPrice)}\nSubtotal: ${formatCurrency(lastInvoice.subtotal)}\n${lastInvoice.discount > 0 ? `Discount: -${formatCurrency(lastInvoice.discount)}\n` : ''}TOTAL DUE: ${formatCurrency(lastInvoice.total)}\n\nThank you for shopping with Eddmobi!\n0722540912`
                    : 'Complete a sale to generate a receipt and invoice here.'}
                </pre>
              </div>

              {/* Today's Sold Items */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Today&apos;s Sold Items</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Item</th>
                        <th className="py-2.5 px-3 text-right">Price</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3">Payment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {todaySalesRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No sales recorded today.
                          </td>
                        </tr>
                      ) : (
                        todaySalesRows.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{s.product}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(s.unitPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{s.qty}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(s.total)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{s.payment}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Today's Product Summary */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Today&apos;s Product Summary</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3 text-right">Total Qty</th>
                        <th className="py-2.5 px-3 text-right">Avg Price</th>
                        <th className="py-2.5 px-3 text-right">Total Sales</th>
                        <th className="py-2.5 px-3">Payments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {todayProductSummary.rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No sales today.
                          </td>
                        </tr>
                      ) : (
                        todayProductSummary.rows.map((row) => (
                          <tr key={row.product}>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{row.product}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.qty}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(row.avgPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(row.total)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">{row.payments}</td>
                          </tr>
                        ))
                      )}
                      <tr className="bg-slate-50 font-semibold text-slate-900">
                        <td className="py-2.5 px-3">Total</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {todayProductSummary.totalQty}
                        </td>
                        <td className="py-2.5 px-3 text-right">—</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {formatCurrency(todayProductSummary.totalSales)}
                        </td>
                        <td className="py-2.5 px-3">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Sales */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Recent Sales</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3">Sold By</th>
                        {perms.canDeleteSales && <th className="py-2.5 px-3 text-right">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {sales.slice(0, 50).map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 px-3 text-xs font-mono tabular-nums text-slate-600">
                            {formatDateTime(s.date)}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{s.product}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{s.qty}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                            {formatCurrency(s.total)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{s.soldBy}</td>
                          {perms.canDeleteSales && (
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleDeleteSale(s)}
                                className="h-7 px-2.5 rounded border border-red-200 hover:bg-red-50 text-xs font-medium text-red-700 cursor-pointer"
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* DAILY SALES */}
          {activeTab === 'dailySales' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-base font-semibold text-slate-900">Daily Sales Lookup</h2>
                  <div className="flex items-center gap-2">
                    <label htmlFor="dailySalesDate" className="text-xs font-medium text-slate-600">
                      Select date:
                    </label>
                    <input
                      id="dailySalesDate"
                      type="date"
                      value={dailySalesDate}
                      onChange={(e) => setDailySalesDate(e.target.value)}
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-xs text-slate-500">Items Sold</div>
                    <div className="text-xl font-bold text-slate-900 font-mono tabular-nums mt-1">
                      {dailySalesData.totalQty}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-xs text-slate-500">Sales Total</div>
                    <div className="text-xl font-bold text-blue-700 font-mono tabular-nums mt-1">
                      {formatCurrency(dailySalesData.totalSales)}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-xs text-slate-500">Profit</div>
                    <div className="text-xl font-bold text-emerald-700 font-mono tabular-nums mt-1">
                      {formatCurrency(dailySalesData.totalProfit)}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3">Item</th>
                        <th className="py-2.5 px-3 text-right">Unit Price</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Sales Total</th>
                        <th className="py-2.5 px-3 text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {dailySalesData.rows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500">
                            No sales recorded for {dailySalesDate}.
                          </td>
                        </tr>
                      ) : (
                        dailySalesData.rows.map(({ sale, date }) => (
                          <tr key={sale.id}>
                            <td className="py-2.5 px-3 font-mono text-xs text-slate-600">
                              {date?.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{sale.product}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(sale.unitPrice)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{sale.qty}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(sale.total)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                              {formatCurrency(sale.profit)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PURCHASES */}
          {activeTab === 'purchases' && (
            <div className="space-y-6">
              <form
                onSubmit={handleAddPurchase}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <h2 className="text-base font-semibold text-slate-900">Add Stock Purchase</h2>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  <div className="md:col-span-5 space-y-2">
                    <input
                      type="text"
                      value={purchaseSearch}
                      onChange={(e) => setPurchaseSearch(e.target.value)}
                      placeholder="Search product..."
                      className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <select
                      size={4}
                      value={purchaseProductId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setPurchaseProductId(id);
                        const found = products.find((p) => p.id === id);
                        if (found && (!purchaseUnitCost || parseFloat(purchaseUnitCost) <= 0)) {
                          setPurchaseUnitCost(String(found.buy || ''));
                        }
                      }}
                      className="w-full p-2 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="">Select Product</option>
                      {filteredPurchaseProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Stock: {p.stock})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="number"
                      min="1"
                      value={purchaseQty}
                      onChange={(e) => setPurchaseQty(e.target.value)}
                      placeholder="Quantity bought"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={purchaseUnitCost}
                      onChange={(e) => setPurchaseUnitCost(e.target.value)}
                      placeholder="Buying price per item (KES)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                    <input
                      value={purchaseSupplier}
                      onChange={(e) => setPurchaseSupplier(e.target.value)}
                      placeholder="Supplier (optional)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <input
                      value={purchaseNote}
                      onChange={(e) => setPurchaseNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <div className="sm:col-span-2 p-3 rounded-lg border border-dashed border-slate-300 space-y-1">
                      <label htmlFor="purchaseReceipt" className="block text-xs font-medium text-slate-700">
                        Supplier receipt (image/PDF, max 700 KB)
                      </label>
                      <input
                        id="purchaseReceipt"
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(e) => setPurchaseReceiptFile(e.target.files?.[0] || null)}
                        className="text-xs text-slate-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer"
                  >
                    Add Purchase & Update Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPurchaseSearch('');
                      setPurchaseProductId('');
                      setPurchaseQty('');
                      setPurchaseUnitCost('');
                      setPurchaseSupplier('');
                      setPurchaseNote('');
                      setPurchaseReceiptFile(null);
                    }}
                    className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                  >
                    Reset Form
                  </button>
                </div>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Recent Purchases</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Product</th>
                        <th className="py-2.5 px-3 text-right">Qty</th>
                        <th className="py-2.5 px-3 text-right">Unit Cost</th>
                        <th className="py-2.5 px-3 text-right">Total</th>
                        <th className="py-2.5 px-3">Supplier</th>
                        <th className="py-2.5 px-3">Recorded By</th>
                        <th className="py-2.5 px-3">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {purchases.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            No purchases recorded yet.
                          </td>
                        </tr>
                      ) : (
                        purchases.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 px-3 text-xs font-mono text-slate-600">
                              {formatDateTime(p.date)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{p.product}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{p.qty}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(p.unitCost)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(p.totalCost)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{p.supplier}</td>
                            <td className="py-2.5 px-3 text-slate-600">{p.recordedBy}</td>
                            <td className="py-2.5 px-3 text-xs">
                              {p.receiptData ? (
                                <a
                                  href={p.receiptData}
                                  download={p.receiptName || 'supplier-receipt'}
                                  className="text-blue-700 hover:underline font-medium"
                                >
                                  Download
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* EXPENSES */}
          {activeTab === 'expenses' && (
            <div className="space-y-6">
              {perms.canAddExpenses && (
                <form
                  onSubmit={handleAddExpense}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                >
                  <h2 className="text-base font-semibold text-slate-900">Record Expense</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      value={expenseName}
                      onChange={(e) => setExpenseName(e.target.value)}
                      placeholder="Expense description"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm sm:col-span-2"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="Amount (KES)"
                      className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer"
                  >
                    Add Expense
                  </button>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Expense Log</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-right">Amount</th>
                        <th className="py-2.5 px-3">Recorded By</th>
                        {perms.canDeleteExpenses && <th className="py-2.5 px-3 text-right">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {expenses.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            No expenses recorded yet.
                          </td>
                        </tr>
                      ) : (
                        expenses.map((exp) => (
                          <tr key={exp.id}>
                            <td className="py-2.5 px-3 text-xs font-mono text-slate-600">
                              {formatDateTime(exp.date)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{exp.name}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium">
                              {formatCurrency(exp.amount)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">{exp.recordedBy}</td>
                            {perms.canDeleteExpenses && (
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteExpense(exp)}
                                  className="h-7 px-2.5 rounded border border-red-200 hover:bg-red-50 text-xs font-medium text-red-700 cursor-pointer"
                                >
                                  Delete
                                </button>
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* REPORTS */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Generate Financial Reports</h2>
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={generateDailyReport}
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer"
                  >
                    Daily Report
                  </button>
                  <button
                    type="button"
                    onClick={generateMonthlyReport}
                    className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer"
                  >
                    Monthly Report
                  </button>
                  {perms.canViewAnnualReport && (
                    <button
                      type="button"
                      onClick={generateAnnualReport}
                      className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer"
                    >
                      Annual Report
                    </button>
                  )}
                  {perms.canExportCSV && (
                    <button
                      type="button"
                      onClick={exportToCSV}
                      className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                      <span>Export to CSV</span>
                    </button>
                  )}
                </div>

                {reportText && (
                  <pre className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 whitespace-pre-wrap">
                    {reportText}
                  </pre>
                )}
              </div>

              {perms.canViewReports ? (
                <ProfitTrendChart sales={sales} expenses={expenses} />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
                  Profit trend reports require administrator access.
                </div>
              )}
            </div>
          )}

          {/* USERS (ADMIN ONLY) */}
          {activeTab === 'users' && perms.canManageUsers && (
            <div className="space-y-6">
              <form
                onSubmit={handleAddStaff}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <h2 className="text-base font-semibold text-slate-900">Add New Staff Member</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <input
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder="Display name"
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                  <input
                    type="email"
                    value={newStaffEmail}
                    onChange={(e) => setNewStaffEmail(e.target.value)}
                    placeholder="Staff Email"
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                  <div className="relative">
                    <input
                      type={showNewStaffPw ? 'text' : 'password'}
                      value={newStaffPassword}
                      onChange={(e) => setNewStaffPassword(e.target.value)}
                      placeholder="Temporary Password"
                      className="w-full h-10 pl-3 pr-10 rounded-lg border border-slate-300 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewStaffPw(!showNewStaffPw)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 cursor-pointer"
                      aria-label={showNewStaffPw ? 'Hide password' : 'Show password'}
                    >
                      {showNewStaffPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <select
                    value={newStaffRole}
                    onChange={(e) => setNewStaffRole(e.target.value as UserRole)}
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="sales">Sales Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={creatingStaff}
                  className="h-10 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {creatingStaff ? 'Creating...' : 'Create Staff Account'}
                </button>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Staff Members</h2>
                <div className="divide-y divide-slate-100">
                  {staffList.map((u) => (
                    <div key={u.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {u.user}{' '}
                          {u.id === currentUser.id && (
                            <span className="text-xs font-normal text-emerald-700">(You)</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                      <span
                        className={`text-xs font-medium px-2.5 py-0.5 rounded border uppercase ${
                          u.role === 'admin'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : 'bg-blue-50 border-blue-200 text-blue-700'
                        }`}
                      >
                        {u.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SUBSCRIPTION & BILLING (ADMIN ONLY) */}
          {activeTab === 'billing' && perms.canManageBilling && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-slate-500">Current Subscription Plan</div>
                  <div className="text-xl font-bold text-slate-900">
                    {orgState.planName || 'Trial / Unassigned'}
                  </div>
                  <div className="text-xs text-slate-600">
                    Status: <span className="font-semibold capitalize">{orgState.subscriptionStatus || 'trial'}</span>
                    {orgState.subscriptionExpiryDate && ` · Expires: ${orgState.subscriptionExpiryDate}`}
                    {orgState.lastPaymentRef && ` · Last Ref: ${orgState.lastPaymentRef}`}
                  </div>
                </div>
                {orgState.planPrice !== undefined && (
                  <div className="text-left sm:text-right">
                    <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                      {formatCurrency(orgState.planPrice)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatCycleLabel(orgState.billingCycle)} billing
                    </div>
                  </div>
                )}
              </div>

              {availablePlans.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-base font-semibold text-slate-900">Available Payment Plans</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {availablePlans.map((plan) => (
                      <div
                        key={plan.id}
                        className={`bg-white border rounded-xl p-5 flex flex-col justify-between space-y-4 ${
                          payPlanId === plan.id ? 'border-blue-600' : 'border-slate-200'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-slate-500">
                            {formatCycleLabel(plan.billingCycle)}
                          </div>
                          <h3 className="text-base font-bold text-slate-900">{plan.name}</h3>
                          <div className="text-xl font-bold text-slate-900 font-mono tabular-nums">
                            {formatCurrency(plan.price)}
                          </div>
                          {plan.description && (
                            <p className="text-xs text-slate-600">{plan.description}</p>
                          )}
                          <ul className="space-y-1 pt-2 border-t border-slate-100 text-xs text-slate-700">
                            {(plan.features || []).map((f, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPayPlanId(plan.id)}
                          className={`h-9 px-3 rounded-lg text-xs font-medium cursor-pointer ${
                            payPlanId === plan.id
                              ? 'bg-blue-700 text-white'
                              : 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
                          }`}
                        >
                          {payPlanId === plan.id ? 'Selected for Payment' : 'Select Plan'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form
                onSubmit={handleSubmitPaymentRequest}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Submit Payment Confirmation</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    After sending M-Pesa or bank payment to 0722540912, enter the transaction code for activation.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <select
                    value={payPlanId}
                    onChange={(e) => setPayPlanId(e.target.value)}
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Select Plan</option>
                    {availablePlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatCurrency(p.price)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={payMethod}
                    onChange={(e) =>
                      setPayMethod(e.target.value as 'M-Pesa' | 'Bank Transfer' | 'Cash' | 'Cheque')
                    }
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Cheque">Cheque</option>
                  </select>
                  <input
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value.toUpperCase())}
                    placeholder="Transaction / M-Pesa Ref"
                    className="h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono uppercase"
                  />
                </div>
                <input
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Optional payment note"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
                <button
                  type="submit"
                  disabled={submittingPayment || availablePlans.length === 0}
                  className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {submittingPayment ? 'Submitting...' : 'Submit Payment Confirmation'}
                </button>
              </form>

              {myPayments.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <h2 className="text-base font-semibold text-slate-900">Payment History</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Plan</th>
                          <th className="py-2.5 px-3">Method & Ref</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {myPayments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 px-3 text-xs font-mono text-slate-600">
                              {formatDateTime(p.createdAt)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{p.planName}</td>
                            <td className="py-2.5 px-3 text-xs text-slate-700">
                              {p.paymentMethod} · <span className="font-mono">{p.transactionRef}</span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {formatCurrency(p.amount)}
                            </td>
                            <td className="py-2.5 px-3 capitalize text-xs font-medium">{p.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Edit Product Modal */}
      {editProductTarget && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Edit Product</h3>
            <form onSubmit={handleSaveProductEdit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Product name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Buying price (KES)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editBuy}
                  onChange={(e) => setEditBuy(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Selling price (KES)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editSell}
                  onChange={(e) => setEditSell(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">Stock quantity</label>
                <input
                  type="number"
                  min="0"
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditProductTarget(null)}
                  className="h-9 px-3.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-9 px-3.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmState && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Confirm Action</h3>
            <p className="text-sm text-slate-600">{confirmState.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="h-9 px-3.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await confirmState.onConfirm();
                  } catch (err: unknown) {
                    const error = err as { message?: string };
                    notify(error.message || 'Action failed.', 'danger');
                  } finally {
                    setConfirmState(null);
                  }
                }}
                className="h-9 px-3.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-medium cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
