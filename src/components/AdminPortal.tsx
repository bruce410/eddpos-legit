import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import {
  LayoutDashboard,
  CreditCard,
  Building2,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Search,
  LogOut,
  ArrowLeftRight,
  AlertTriangle,
  ShieldCheck,
  X,
  Menu,
  Check,
  Ban,
  Copy,
  FileCode2,
} from 'lucide-react';
import { db, serverTimestamp } from '../lib/firebase';
import {
  addCycleToDate,
  formatCurrency,
  formatCycleLabel,
  formatDateTime,
  formatShortDate,
  getTodayIsoDate,
} from '../lib/formatters';
import {
  SUPER_ADMIN_EMAIL,
  type BillingCycle,
  type ClientPaymentSubmission,
  type Organization,
  type PaymentPlan,
  type SubscriptionStatus,
  type UserProfile,
} from '../types/pos';

type AdminTab = 'overview' | 'plans' | 'clients' | 'approvals';

interface AdminPortalProps {
  userEmail: string;
  hasOwnPosOrg: boolean;
  onSwitchToPos: () => void;
  onSignOut: () => void;
}

const DEFAULT_PLAN_TEMPLATES: Omit<PaymentPlan, 'id'>[] = [
  {
    name: 'Starter Shop',
    code: 'STARTER',
    description: 'For single-counter retail shops tracking daily sales and stock.',
    price: 1500,
    setupFee: 0,
    billingCycle: 'monthly',
    trialDays: 14,
    maxUsers: 2,
    maxProducts: 250,
    features: [
      'Up to 2 staff accounts',
      'Up to 250 inventory SKUs',
      'Daily sales & receipt printing',
      'Low-stock dashboard alerts',
    ],
    isActive: true,
    isRecommended: false,
  },
  {
    name: 'Business Growth',
    code: 'GROWTH',
    description: 'For growing retail stores needing purchases, expenses, and profit trends.',
    price: 3500,
    setupFee: 0,
    billingCycle: 'monthly',
    trialDays: 14,
    maxUsers: 8,
    maxProducts: 2000,
    features: [
      'Up to 8 staff accounts',
      'Up to 2,000 inventory SKUs',
      'Supplier purchases & receipt uploads',
      'Weekly, monthly & annual profit trends',
      'CSV data exports',
    ],
    isActive: true,
    isRecommended: true,
  },
  {
    name: 'Enterprise Multi-Staff',
    code: 'ENTERPRISE',
    description: 'For high-volume shops and electronics dealers with unlimited catalog.',
    price: 7500,
    setupFee: 0,
    billingCycle: 'monthly',
    trialDays: 30,
    maxUsers: 50,
    maxProducts: 25000,
    features: [
      'Up to 50 staff accounts',
      'Unlimited-scale product catalog',
      'Full financial & expense audit logs',
      'Priority WhatsApp & phone support',
    ],
    isActive: true,
    isRecommended: false,
  },
];

const FIRESTORE_RULES_SNIPPET = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSuperAdmin() {
      return request.auth != null &&
        request.auth.token.email == '${SUPER_ADMIN_EMAIL}';
    }

    match /paymentPlans/{planId} {
      allow read: if request.auth != null;
      allow write: if isSuperAdmin();
    }

    match /clientPayments/{paymentId} {
      allow read: if request.auth != null && (
        isSuperAdmin() ||
        resource.data.orgId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.orgId
      );
      allow create: if request.auth != null;
      allow update, delete: if isSuperAdmin();
    }

    match /organizations/{orgId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if isSuperAdmin() || resource.data.ownerId == request.auth.uid;
    }

    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if isSuperAdmin() || request.auth.uid == userId;
    }
  }
}`;

export const AdminPortal: React.FC<AdminPortalProps> = ({
  userEmail,
  hasOwnPosOrg,
  onSwitchToPos,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [clients, setClients] = useState<Organization[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<ClientPaymentSubmission[]>([]);

  const [loading, setLoading] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ message: string; type: 'success' | 'danger' | 'warning' } | null>(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  // Filters
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState<'all' | SubscriptionStatus>('all');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Plan Modal State
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PaymentPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planCode, setPlanCode] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [planSetupFee, setPlanSetupFee] = useState('0');
  const [planCycle, setPlanCycle] = useState<BillingCycle>('monthly');
  const [planTrialDays, setPlanTrialDays] = useState('14');
  const [planMaxUsers, setPlanMaxUsers] = useState('5');
  const [planMaxProducts, setPlanMaxProducts] = useState('500');
  const [planFeaturesText, setPlanFeaturesText] = useState('');
  const [planIsActive, setPlanIsActive] = useState(true);
  const [planIsRecommended, setPlanIsRecommended] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  // Assign / Edit Client Plan Modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Organization | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [clientPlanPrice, setClientPlanPrice] = useState('');
  const [clientCycle, setClientCycle] = useState<BillingCycle>('monthly');
  const [clientSubStatus, setClientSubStatus] = useState<SubscriptionStatus>('active');
  const [clientStartDate, setClientStartDate] = useState(getTodayIsoDate());
  const [clientExpiryDate, setClientExpiryDate] = useState(addCycleToDate(getTodayIsoDate(), 'monthly'));
  const [clientPaymentRef, setClientPaymentRef] = useState('');
  const [clientPaymentAmount, setClientPaymentAmount] = useState('');
  const [clientBillingNotes, setClientBillingNotes] = useState('');
  const [savingClientPlan, setSavingClientPlan] = useState(false);

  // Add New Client Organization Modal
  const [newClientModalOpen, setNewClientModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientPlanId, setNewClientPlanId] = useState('');
  const [newClientStatus, setNewClientStatus] = useState<SubscriptionStatus>('active');
  const [savingNewClient, setSavingNewClient] = useState(false);

  // Delete confirmation
  const [confirmDeletePlan, setConfirmDeletePlan] = useState<PaymentPlan | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'danger' | 'warning' = 'success') => {
    setAlert({ message, type });
    setTimeout(() => {
      setAlert((curr) => (curr?.message === message ? null : curr));
    }, 5000);
  }, []);

  const loadClientsAndUsers = useCallback(async () => {
    try {
      const [orgSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'organizations')),
        getDocs(collection(db, 'users')),
      ]);

      const users: UserProfile[] = [];
      usersSnap.forEach((d) => {
        users.push({ id: d.id, ...(d.data() as Omit<UserProfile, 'id'>) });
      });
      setUsersList(users);

      const orgs: Organization[] = [];
      orgSnap.forEach((d) => {
        const data = d.data() as Omit<Organization, 'id'>;
        const ownerUser = users.find((u) => u.id === data.ownerId) || users.find((u) => u.orgId === d.id && u.role === 'admin');
        orgs.push({
          id: d.id,
          ...data,
          ownerEmail: data.ownerEmail || ownerUser?.email || '',
          subscriptionStatus: data.subscriptionStatus || (data.planName ? 'active' : 'unassigned'),
        });
      });

      orgs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setClients(orgs);
      setPermissionError(null);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'permission-denied') {
        setPermissionError(
          'Firestore security rules currently restrict reading all client organizations or payment plans. Update your Firebase rules to allow super admin access.'
        );
      } else {
        notify(error.message || 'Could not load client businesses.', 'danger');
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    setLoading(true);
    loadClientsAndUsers();

    const unsubPlans = onSnapshot(
      query(collection(db, 'paymentPlans'), orderBy('price', 'asc')),
      (snap) => {
        const items: PaymentPlan[] = [];
        snap.forEach((d) => {
          items.push({ id: d.id, ...(d.data() as Omit<PaymentPlan, 'id'>) });
        });
        setPlans(items);
      },
      (err) => {
        if (err.code === 'permission-denied') {
          setPermissionError(
            'Firestore security rules blocked reading paymentPlans. Update your Firestore rules to allow access.'
          );
        }
      }
    );

    const unsubPayments = onSnapshot(
      query(collection(db, 'clientPayments'), orderBy('createdAt', 'desc')),
      (snap) => {
        const items: ClientPaymentSubmission[] = [];
        snap.forEach((d) => {
          items.push({ id: d.id, ...(d.data() as Omit<ClientPaymentSubmission, 'id'>) });
        });
        setPaymentRequests(items);
      },
      () => {
        // Ignore if collection does not exist or rules restrict it
      }
    );

    const unsubOrgs = onSnapshot(
      collection(db, 'organizations'),
      () => {
        loadClientsAndUsers();
      },
      () => {}
    );

    return () => {
      unsubPlans();
      unsubPayments();
      unsubOrgs();
    };
  }, [loadClientsAndUsers]);

  // Derived metrics
  const staffCountByOrg = useMemo(() => {
    const map: Record<string, number> = {};
    usersList.forEach((u) => {
      if (u.orgId) map[u.orgId] = (map[u.orgId] || 0) + 1;
    });
    return map;
  }, [usersList]);

  const clientsByPlanId = useMemo(() => {
    const map: Record<string, number> = {};
    clients.forEach((c) => {
      if (c.planId) map[c.planId] = (map[c.planId] || 0) + 1;
    });
    return map;
  }, [clients]);

  const metrics = useMemo(() => {
    const totalClients = clients.length;
    const activeSubs = clients.filter((c) => c.subscriptionStatus === 'active').length;
    const pendingApprovals = paymentRequests.filter((p) => p.status === 'pending').length;
    const mrr = clients
      .filter((c) => c.subscriptionStatus === 'active')
      .reduce((sum, c) => {
        const price = Number(c.planPrice) || 0;
        if (c.billingCycle === 'annual') return sum + price / 12;
        if (c.billingCycle === 'quarterly') return sum + price / 3;
        return sum + price;
      }, 0);

    return { totalClients, activeSubs, pendingApprovals, mrr };
  }, [clients, paymentRequests]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return clients.filter((c) => {
      const matchesStatus =
        clientStatusFilter === 'all' || (c.subscriptionStatus || 'unassigned') === clientStatusFilter;
      if (!matchesStatus) return false;
      if (!q) return true;
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.ownerEmail || '').toLowerCase().includes(q) ||
        (c.planName || '').toLowerCase().includes(q) ||
        (c.lastPaymentRef || '').toLowerCase().includes(q)
      );
    });
  }, [clients, clientSearch, clientStatusFilter]);

  const filteredApprovals = useMemo(() => {
    if (approvalFilter === 'all') return paymentRequests;
    return paymentRequests.filter((p) => p.status === approvalFilter);
  }, [paymentRequests, approvalFilter]);

  // Plan Modal Handlers
  const openCreatePlanModal = () => {
    setEditingPlan(null);
    setPlanName('');
    setPlanCode('');
    setPlanDesc('');
    setPlanPrice('');
    setPlanSetupFee('0');
    setPlanCycle('monthly');
    setPlanTrialDays('14');
    setPlanMaxUsers('5');
    setPlanMaxProducts('500');
    setPlanFeaturesText('Point of Sale & Receipt Printing\nInventory & Low-Stock Alerts\nDaily & Monthly Profit Reports');
    setPlanIsActive(true);
    setPlanIsRecommended(false);
    setPlanModalOpen(true);
  };

  const openEditPlanModal = (plan: PaymentPlan) => {
    setEditingPlan(plan);
    setPlanName(plan.name);
    setPlanCode(plan.code || '');
    setPlanDesc(plan.description || '');
    setPlanPrice(String(plan.price ?? 0));
    setPlanSetupFee(String(plan.setupFee ?? 0));
    setPlanCycle(plan.billingCycle || 'monthly');
    setPlanTrialDays(String(plan.trialDays ?? 0));
    setPlanMaxUsers(String(plan.maxUsers ?? 5));
    setPlanMaxProducts(String(plan.maxProducts ?? 500));
    setPlanFeaturesText((plan.features || []).join('\n'));
    setPlanIsActive(plan.isActive !== false);
    setPlanIsRecommended(Boolean(plan.isRecommended));
    setPlanModalOpen(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = planName.trim();
    const price = parseFloat(planPrice);
    const setupFee = parseFloat(planSetupFee) || 0;
    const trialDays = parseInt(planTrialDays, 10) || 0;
    const maxUsers = parseInt(planMaxUsers, 10) || 1;
    const maxProducts = parseInt(planMaxProducts, 10) || 100;

    if (!name || Number.isNaN(price) || price < 0) {
      notify('Enter a valid plan name and price in KES.', 'danger');
      return;
    }

    const features = planFeaturesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const payload = {
      name,
      code: (planCode.trim() || name.replace(/[^a-zA-Z0-9]/g, '')).toUpperCase().slice(0, 16),
      description: planDesc.trim(),
      price,
      setupFee,
      billingCycle: planCycle,
      trialDays,
      maxUsers,
      maxProducts,
      features,
      isActive: planIsActive,
      isRecommended: planIsRecommended,
      updatedAt: serverTimestamp(),
    };

    setSavingPlan(true);
    try {
      if (editingPlan) {
        await updateDoc(doc(db, 'paymentPlans', editingPlan.id), payload);
        notify(`Payment plan "${name}" updated.`, 'success');
      } else {
        await addDoc(collection(db, 'paymentPlans'), {
          ...payload,
          createdBy: userEmail,
          createdAt: serverTimestamp(),
        });
        notify(`Payment plan "${name}" created.`, 'success');
      }
      setPlanModalOpen(false);
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Failed to save payment plan.', 'danger');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSeedStarterPlans = async () => {
    setSavingPlan(true);
    try {
      await Promise.all(
        DEFAULT_PLAN_TEMPLATES.map((tpl) =>
          addDoc(collection(db, 'paymentPlans'), {
            ...tpl,
            createdBy: userEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );
      notify('Standard Starter, Business Growth, and Enterprise plans added.', 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not seed starter plans.', 'danger');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleTogglePlanActive = async (plan: PaymentPlan) => {
    try {
      await updateDoc(doc(db, 'paymentPlans', plan.id), {
        isActive: !plan.isActive,
        updatedAt: serverTimestamp(),
      });
      notify(`"${plan.name}" is now ${!plan.isActive ? 'active' : 'archived'}.`, 'success');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not update plan status.', 'danger');
    }
  };

  const handleDeletePlan = async () => {
    if (!confirmDeletePlan) return;
    try {
      await deleteDoc(doc(db, 'paymentPlans', confirmDeletePlan.id));
      notify(`Deleted plan "${confirmDeletePlan.name}".`, 'success');
      setConfirmDeletePlan(null);
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not delete plan.', 'danger');
    }
  };

  // Client Plan Assignment Handlers
  const openEditClientModal = (client: Organization) => {
    setEditingClient(client);
    const matchingPlan = plans.find((p) => p.id === client.planId) || plans[0];
    const start = client.subscriptionStartDate || getTodayIsoDate();
    const cycle = client.billingCycle || matchingPlan?.billingCycle || 'monthly';

    setSelectedPlanId(client.planId || matchingPlan?.id || '');
    setClientPlanPrice(
      client.planPrice !== undefined ? String(client.planPrice) : matchingPlan ? String(matchingPlan.price) : '0'
    );
    setClientCycle(cycle);
    setClientSubStatus(client.subscriptionStatus || 'active');
    setClientStartDate(start);
    setClientExpiryDate(client.subscriptionExpiryDate || addCycleToDate(start, cycle));
    setClientPaymentRef(client.lastPaymentRef || '');
    setClientPaymentAmount(
      client.lastPaymentAmount !== undefined
        ? String(client.lastPaymentAmount)
        : matchingPlan
        ? String(matchingPlan.price)
        : ''
    );
    setClientBillingNotes(client.billingNotes || '');
    setClientModalOpen(true);
  };

  const handlePlanSelectForClient = (planId: string) => {
    setSelectedPlanId(planId);
    const found = plans.find((p) => p.id === planId);
    if (found) {
      setClientPlanPrice(String(found.price));
      setClientCycle(found.billingCycle);
      setClientExpiryDate(addCycleToDate(clientStartDate, found.billingCycle));
      if (!clientPaymentAmount) {
        setClientPaymentAmount(String(found.price));
      }
    }
  };

  const handleSaveClientPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;

    const chosenPlan = plans.find((p) => p.id === selectedPlanId);
    const price = parseFloat(clientPlanPrice) || 0;
    const paidAmount = parseFloat(clientPaymentAmount) || 0;

    setSavingClientPlan(true);
    try {
      await updateDoc(doc(db, 'organizations', editingClient.id), {
        planId: chosenPlan?.id || selectedPlanId || '',
        planName: chosenPlan?.name || editingClient.planName || 'Custom Plan',
        planPrice: price,
        billingCycle: clientCycle,
        subscriptionStatus: clientSubStatus,
        subscriptionStartDate: clientStartDate,
        subscriptionExpiryDate: clientExpiryDate,
        lastPaymentRef: clientPaymentRef.trim(),
        lastPaymentAmount: paidAmount,
        lastPaymentDate: clientPaymentRef.trim() ? getTodayIsoDate() : editingClient.lastPaymentDate || '',
        billingNotes: clientBillingNotes.trim(),
        updatedAt: serverTimestamp(),
      });

      // If admin entered a fresh payment ref that isn't empty and amount > 0, optionally record in ledger if needed
      notify(`Updated payment plan for "${editingClient.name}".`, 'success');
      setClientModalOpen(false);
      await loadClientsAndUsers();
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not update client payment plan.', 'danger');
    } finally {
      setSavingClientPlan(false);
    }
  };

  const handleCreateClientOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newClientName.trim();
    const email = newClientEmail.trim().toLowerCase();
    if (!name) {
      notify('Enter the client business name.', 'danger');
      return;
    }

    const plan = plans.find((p) => p.id === newClientPlanId);
    const today = getTodayIsoDate();
    const cycle = plan?.billingCycle || 'monthly';

    setSavingNewClient(true);
    try {
      await addDoc(collection(db, 'organizations'), {
        name,
        ownerId: '',
        ownerEmail: email,
        phone: newClientPhone.trim(),
        planId: plan?.id || '',
        planName: plan?.name || (newClientStatus === 'trial' ? 'Trial' : 'Unassigned'),
        planPrice: plan?.price ?? 0,
        billingCycle: cycle,
        subscriptionStatus: newClientStatus,
        subscriptionStartDate: today,
        subscriptionExpiryDate: addCycleToDate(today, cycle),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      notify(`Client business "${name}" added.`, 'success');
      setNewClientName('');
      setNewClientEmail('');
      setNewClientPhone('');
      setNewClientModalOpen(false);
      await loadClientsAndUsers();
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Could not create client business.', 'danger');
    } finally {
      setSavingNewClient(false);
    }
  };

  // Payment Approvals Handlers
  const handleApprovePayment = async (payment: ClientPaymentSubmission) => {
    try {
      const today = getTodayIsoDate();
      const nextExpiry = addCycleToDate(today, payment.billingCycle || 'monthly');

      await updateDoc(doc(db, 'clientPayments', payment.id), {
        status: 'approved',
        reviewedBy: userEmail,
        reviewedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'organizations', payment.orgId), {
        planId: payment.planId,
        planName: payment.planName,
        planPrice: payment.amount,
        billingCycle: payment.billingCycle || 'monthly',
        subscriptionStatus: 'active',
        subscriptionStartDate: today,
        subscriptionExpiryDate: nextExpiry,
        lastPaymentRef: payment.transactionRef,
        lastPaymentAmount: payment.amount,
        lastPaymentDate: today,
        updatedAt: serverTimestamp(),
      });

      notify(`Approved payment ${payment.transactionRef} and activated ${payment.orgName}.`, 'success');
      await loadClientsAndUsers();
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Failed to approve payment.', 'danger');
    }
  };

  const handleRejectPayment = async (payment: ClientPaymentSubmission) => {
    try {
      await updateDoc(doc(db, 'clientPayments', payment.id), {
        status: 'rejected',
        reviewedBy: userEmail,
        reviewedAt: serverTimestamp(),
      });
      notify(`Payment ${payment.transactionRef} marked as rejected.`, 'warning');
    } catch (err: unknown) {
      const error = err as { message?: string };
      notify(error.message || 'Failed to reject payment.', 'danger');
    }
  };

  const statusLabel = (status?: SubscriptionStatus) => {
    switch (status) {
      case 'active':
        return { text: 'Active', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      case 'trial':
        return { text: 'Trial', cls: 'text-blue-700 bg-blue-50 border-blue-200' };
      case 'past_due':
        return { text: 'Past Due', cls: 'text-amber-700 bg-amber-50 border-amber-200' };
      case 'suspended':
        return { text: 'Suspended', cls: 'text-red-700 bg-red-50 border-red-200' };
      default:
        return { text: 'Unassigned', cls: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const tabMeta: Record<AdminTab, { title: string; ctaLabel: string; ctaAction: () => void }> = {
    overview: { title: 'Platform Overview', ctaLabel: 'Add Payment Plan', ctaAction: openCreatePlanModal },
    plans: { title: 'Payment Plans', ctaLabel: 'Add Payment Plan', ctaAction: openCreatePlanModal },
    clients: {
      title: 'Clients & Subscriptions',
      ctaLabel: 'Add Client Business',
      ctaAction: () => {
        setNewClientPlanId(plans[0]?.id || '');
        setNewClientModalOpen(true);
      },
    },
    approvals: { title: 'Payment Approvals', ctaLabel: 'Add Payment Plan', ctaAction: openCreatePlanModal },
  };

  const copyRules = () => {
    navigator.clipboard.writeText(FIRESTORE_RULES_SNIPPET);
    setCopiedRules(true);
    setTimeout(() => setCopiedRules(false), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar (256px) */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-slate-950 text-slate-100 flex flex-col justify-between transition-transform duration-200 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
              EDDMOBI Admin
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

          <div className="px-4 py-4 border-b border-slate-800/80">
            <div className="text-xs text-slate-400">Super Administrator</div>
            <div className="text-xs font-medium text-slate-100 truncate mt-0.5">{userEmail}</div>
          </div>

          <nav className="p-3 space-y-1" aria-label="Admin Portal Navigation">
            {(
              [
                { id: 'overview', label: 'Overview', icon: LayoutDashboard },
                { id: 'plans', label: 'Payment Plans', icon: CreditCard },
                { id: 'clients', label: 'Clients & Plans', icon: Building2 },
                { id: 'approvals', label: 'Payment Approvals', icon: CheckCircle2 },
              ] as const
            ).map((item) => {
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
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-blue-700 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'approvals' && metrics.pendingApprovals > 0 && (
                    <span className="text-xs font-mono tabular-nums text-amber-300">
                      {metrics.pendingApprovals}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-800 space-y-1.5">
          {hasOwnPosOrg && (
            <button
              type="button"
              onClick={onSwitchToPos}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <ArrowLeftRight className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Open POS Terminal</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRulesModal(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileCode2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Firestore Rules</span>
          </button>
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

      {/* Main Workspace */}
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
              Platform Admin <span className="text-slate-400 font-normal">/</span>{' '}
              {tabMeta[activeTab].title}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('plans')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Plans
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('clients')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Clients
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('approvals')}
              className="hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Approvals
            </button>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={tabMeta[activeTab].ctaAction}
              className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{tabMeta[activeTab].ctaLabel}</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="h-10 px-3.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
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
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {permissionError && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm text-amber-900">
                  <div className="font-semibold">Firebase Firestore Rules Update Needed</div>
                  <p className="text-xs text-amber-800 mt-0.5">{permissionError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRulesModal(true)}
                className="px-3.5 py-2 rounded-lg bg-amber-900 hover:bg-amber-950 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                View Required Rules
              </button>
            </div>
          )}

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Client Businesses</div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
                    {metrics.totalClients}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Registered organizations</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Active Subscriptions</div>
                  <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums mt-2">
                    {metrics.activeSubs}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Clients with active plans</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Monthly Recurring Revenue</div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-2">
                    {formatCurrency(metrics.mrr)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Estimated monthly total</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="text-xs font-medium text-slate-500">Pending Payment Reviews</div>
                  <div className="text-2xl font-bold text-amber-700 font-mono tabular-nums mt-2">
                    {metrics.pendingApprovals}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Awaiting admin approval</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Payment Plans Snapshot */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Payment Plans</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {plans.length} configured plans
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('plans')}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      Manage all
                    </button>
                  </div>

                  {plans.length === 0 ? (
                    <div className="py-8 text-center space-y-3 border-t border-slate-100">
                      <p className="text-sm text-slate-500">No payment plans created yet.</p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={openCreatePlanModal}
                          className="px-3.5 py-2 rounded-lg bg-blue-700 text-white text-xs font-medium cursor-pointer"
                        >
                          Create Custom Plan
                        </button>
                        <button
                          type="button"
                          onClick={handleSeedStarterPlans}
                          disabled={savingPlan}
                          className="px-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                        >
                          Load 3 Starter Plans
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {plans.map((plan) => (
                        <div key={plan.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {plan.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatCycleLabel(plan.billingCycle)} ·{' '}
                              {clientsByPlanId[plan.id] || 0} clients ·{' '}
                              {plan.isActive ? 'Active' : 'Archived'}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums">
                              {formatCurrency(plan.price)}
                            </span>
                            <button
                              type="button"
                              onClick={() => openEditPlanModal(plan)}
                              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                              aria-label={`Edit ${plan.name}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Clients Snapshot */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Client Organizations</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Click Edit Plan to assign or update any client subscription.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('clients')}
                      className="text-xs font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      View all clients
                    </button>
                  </div>

                  {loading ? (
                    <div className="space-y-3 py-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-11 bg-slate-100 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : clients.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-500 border-t border-slate-100">
                      No client businesses found yet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                            <th className="py-2.5 pr-4">Business</th>
                            <th className="py-2.5 px-3">Plan</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3 text-right">Expiry</th>
                            <th className="py-2.5 pl-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {clients.slice(0, 6).map((client) => {
                            const st = statusLabel(client.subscriptionStatus);
                            return (
                              <tr key={client.id} className="hover:bg-slate-50/80">
                                <td className="py-3 pr-4">
                                  <div className="font-medium text-slate-900">{client.name}</div>
                                  <div className="text-xs text-slate-500">{client.ownerEmail || '—'}</div>
                                </td>
                                <td className="py-3 px-3">
                                  <div className="font-medium text-slate-800">
                                    {client.planName || 'Unassigned'}
                                  </div>
                                  {client.planPrice !== undefined && (
                                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                                      {formatCurrency(client.planPrice)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-3">
                                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${st.cls}`}>
                                    {st.text}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-right text-xs text-slate-600 font-mono tabular-nums">
                                  {client.subscriptionExpiryDate || '—'}
                                </td>
                                <td className="py-3 pl-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => openEditClientModal(client)}
                                    className="px-2.5 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                                  >
                                    Edit Plan
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT PLANS TAB */}
          {activeTab === 'plans' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Client Payment Plans</h2>
                  <p className="text-sm text-slate-500">
                    Create and edit subscription tiers, pricing in KES, billing cycles, and feature limits.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {plans.length === 0 && (
                    <button
                      type="button"
                      onClick={handleSeedStarterPlans}
                      disabled={savingPlan}
                      className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                    >
                      Load Starter Plans
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openCreatePlanModal}
                    className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium flex items-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    <span>New Payment Plan</span>
                  </button>
                </div>
              </div>

              {plans.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                  <CreditCard className="w-8 h-8 text-slate-400 mx-auto" aria-hidden="true" />
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-slate-900">No payment plans yet</h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                      Add your first payment plan so client businesses can subscribe or be assigned a billing tier.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={openCreatePlanModal}
                      className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer"
                    >
                      Add Payment Plan
                    </button>
                    <button
                      type="button"
                      onClick={handleSeedStarterPlans}
                      disabled={savingPlan}
                      className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
                    >
                      Add 3 Standard Plans
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {plans.map((plan) => (
                    <div
                      key={plan.id}
                      className={`bg-white border rounded-xl p-6 flex flex-col justify-between space-y-5 ${
                        plan.isRecommended ? 'border-blue-600' : 'border-slate-200'
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-medium text-slate-500">
                              {plan.code || 'PLAN'} · {formatCycleLabel(plan.billingCycle)}
                              {plan.isRecommended ? ' · Recommended' : ''}
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 mt-0.5">{plan.name}</h3>
                          </div>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded border ${
                              plan.isActive
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-slate-100 border-slate-200 text-slate-600'
                            }`}
                          >
                            {plan.isActive ? 'Active' : 'Archived'}
                          </span>
                        </div>

                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                            {formatCurrency(plan.price)}
                          </span>
                          <span className="text-xs text-slate-500">
                            / {formatCycleLabel(plan.billingCycle).toLowerCase()}
                          </span>
                        </div>

                        {plan.description && (
                          <p className="text-sm text-slate-600 leading-relaxed">{plan.description}</p>
                        )}

                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-xs">
                          <div>
                            <div className="text-slate-500">Staff limit</div>
                            <div className="font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                              {plan.maxUsers}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500">SKU limit</div>
                            <div className="font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                              {plan.maxProducts}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500">Trial</div>
                            <div className="font-semibold text-slate-900 font-mono tabular-nums mt-0.5">
                              {plan.trialDays}d
                            </div>
                          </div>
                        </div>

                        {plan.features && plan.features.length > 0 && (
                          <ul className="space-y-1.5 pt-2 border-t border-slate-100 text-xs text-slate-700">
                            {plan.features.map((feat, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          {clientsByPlanId[plan.id] || 0} assigned
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditPlanModal(plan)}
                            className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTogglePlanActive(plan)}
                            className="h-9 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                          >
                            {plan.isActive ? 'Archive' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePlan(plan)}
                            aria-label={`Delete ${plan.name}`}
                            className="h-9 px-2.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CLIENTS & SUBSCRIPTIONS TAB */}
          {activeTab === 'clients' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Clients & Payment Plans</h2>
                  <p className="text-sm text-slate-500">
                    Assign payment plans, update renewal dates, or record direct client payments.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewClientPlanId(plans[0]?.id || '');
                    setNewClientModalOpen(true);
                  }}
                  className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Add Client Business</span>
                </button>
              </div>

              {/* Search & Status Filter */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                  <input
                    type="search"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search client business, email, plan, or M-Pesa ref..."
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                  />
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                  {(['all', 'active', 'trial', 'past_due', 'suspended', 'unassigned'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setClientStatusFilter(st)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap capitalize ${
                        clientStatusFilter === st
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Client Business</th>
                        <th className="py-3 px-4">Assigned Plan</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Expiry Date</th>
                        <th className="py-3 px-4">Last Payment Ref</th>
                        <th className="py-3 px-4 text-right">Staff</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredClients.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-slate-500">
                            No client businesses match the current search or filter.
                          </td>
                        </tr>
                      ) : (
                        filteredClients.map((client) => {
                          const st = statusLabel(client.subscriptionStatus);
                          return (
                            <tr key={client.id} className="hover:bg-slate-50/70">
                              <td className="py-3.5 px-4">
                                <div className="font-semibold text-slate-900">{client.name}</div>
                                <div className="text-xs text-slate-500">
                                  {client.ownerEmail || 'No owner email'}
                                  {client.phone ? ` · ${client.phone}` : ''}
                                </div>
                              </td>
                              <td className="py-3.5 px-4">
                                <div className="font-medium text-slate-800">
                                  {client.planName || 'Unassigned'}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {formatCycleLabel(client.billingCycle)}
                                </div>
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                                {client.planPrice !== undefined ? formatCurrency(client.planPrice) : '—'}
                              </td>
                              <td className="py-3.5 px-4">
                                <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${st.cls}`}>
                                  {st.text}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-700">
                                {client.subscriptionExpiryDate || '—'}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                                {client.lastPaymentRef || '—'}
                              </td>
                              <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                                {staffCountByOrg[client.id] || 0}
                              </td>
                              <td className="py-3.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => openEditClientModal(client)}
                                  className="h-8 px-3 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                                >
                                  Edit Plan
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PAYMENT APPROVALS TAB */}
          {activeTab === 'approvals' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Client Payment Approvals</h2>
                  <p className="text-sm text-slate-500">
                    Review M-Pesa, bank, and cash payment submissions from client admins.
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setApprovalFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize cursor-pointer whitespace-nowrap ${
                        approvalFilter === f
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Client Business</th>
                        <th className="py-3 px-4">Plan</th>
                        <th className="py-3 px-4">Method & Ref</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredApprovals.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-500">
                            No payment submissions match this filter.
                          </td>
                        </tr>
                      ) : (
                        filteredApprovals.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="py-3.5 px-4 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                              {formatDateTime(item.createdAt)}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-slate-900">{item.orgName}</div>
                              <div className="text-xs text-slate-500">{item.submittedEmail}</div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-medium text-slate-800">{item.planName}</div>
                              <div className="text-xs text-slate-500">
                                {formatCycleLabel(item.billingCycle)}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="text-slate-800">{item.paymentMethod}</div>
                              <div className="text-xs font-mono text-slate-500">{item.transactionRef}</div>
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {formatCurrency(item.amount)}
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-block text-xs font-medium px-2 py-0.5 rounded border capitalize ${
                                  item.status === 'approved'
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : item.status === 'rejected'
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : 'bg-amber-50 border-amber-200 text-amber-700'
                                }`}
                              >
                                {item.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              {item.status === 'pending' ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleApprovePayment(item)}
                                    className="h-8 px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Approve</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRejectPayment(item)}
                                    className="h-8 px-2.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                                    <span>Reject</span>
                                  </button>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">
                                  {item.reviewedBy ? `Reviewed by ${item.reviewedBy}` : 'Processed'}
                                </span>
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
        </main>
      </div>

      {/* ADD / EDIT PAYMENT PLAN MODAL */}
      {planModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editingPlan ? `Edit Plan: ${editingPlan.name}` : 'Add Payment Plan'}
              </h3>
              <button
                type="button"
                onClick={() => setPlanModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Plan Name</label>
                  <input
                    required
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder="e.g. Business Growth"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Plan Code</label>
                  <input
                    value={planCode}
                    onChange={(e) => setPlanCode(e.target.value.toUpperCase())}
                    placeholder="e.g. GROWTH"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Price (KES)</label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={planPrice}
                    onChange={(e) => setPlanPrice(e.target.value)}
                    placeholder="3500"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Billing Cycle</label>
                  <select
                    value={planCycle}
                    onChange={(e) => setPlanCycle(e.target.value as BillingCycle)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly (3 Months)</option>
                    <option value="annual">Annual (12 Months)</option>
                    <option value="one-time">One-Time</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Setup Fee (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={planSetupFee}
                    onChange={(e) => setPlanSetupFee(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Trial Days</label>
                  <input
                    type="number"
                    min="0"
                    value={planTrialDays}
                    onChange={(e) => setPlanTrialDays(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Max Staff Users</label>
                  <input
                    type="number"
                    min="1"
                    value={planMaxUsers}
                    onChange={(e) => setPlanMaxUsers(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Max Products</label>
                  <input
                    type="number"
                    min="1"
                    value={planMaxProducts}
                    onChange={(e) => setPlanMaxProducts(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Description</label>
                <input
                  value={planDesc}
                  onChange={(e) => setPlanDesc(e.target.value)}
                  placeholder="Short description of who this plan is for"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Included Features (one per line)
                </label>
                <textarea
                  rows={4}
                  value={planFeaturesText}
                  onChange={(e) => setPlanFeaturesText(e.target.value)}
                  className="w-full p-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planIsActive}
                    onChange={(e) => setPlanIsActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Active (visible to clients)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planIsRecommended}
                    onChange={(e) => setPlanIsRecommended(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Highlight as recommended</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(false)}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingPlan ? 'Saving...' : editingPlan ? 'Save Plan Changes' : 'Create Payment Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSIGN / EDIT CLIENT PLAN MODAL */}
      {clientModalOpen && editingClient && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Edit Client Payment Plan</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingClient.name} {editingClient.ownerEmail ? `· ${editingClient.ownerEmail}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClientModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClientPlan} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Payment Plan</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => handlePlanSelectForClient(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Custom / Select a plan</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.price)} ({formatCycleLabel(p.billingCycle)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Client Rate (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={clientPlanPrice}
                    onChange={(e) => setClientPlanPrice(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Billing Cycle</label>
                  <select
                    value={clientCycle}
                    onChange={(e) => {
                      const nextCycle = e.target.value as BillingCycle;
                      setClientCycle(nextCycle);
                      setClientExpiryDate(addCycleToDate(clientStartDate, nextCycle));
                    }}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="one-time">One-Time</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={clientSubStatus}
                    onChange={(e) => setClientSubStatus(e.target.value as SubscriptionStatus)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="past_due">Past Due</option>
                    <option value="suspended">Suspended</option>
                    <option value="unassigned">Unassigned</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Start Date</label>
                  <input
                    type="date"
                    value={clientStartDate}
                    onChange={(e) => setClientStartDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Expiry / Renewal Date</label>
                  <input
                    type="date"
                    value={clientExpiryDate}
                    onChange={(e) => setClientExpiryDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    M-Pesa / Payment Reference
                  </label>
                  <input
                    value={clientPaymentRef}
                    onChange={(e) => setClientPaymentRef(e.target.value.toUpperCase())}
                    placeholder="e.g. TJK8219PQ0"
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Amount Paid (KES)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={clientPaymentAmount}
                    onChange={(e) => setClientPaymentAmount(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Billing Notes</label>
                <textarea
                  rows={2}
                  value={clientBillingNotes}
                  onChange={(e) => setClientBillingNotes(e.target.value)}
                  placeholder="Optional payment or agreement notes"
                  className="w-full p-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setClientModalOpen(false)}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingClientPlan}
                  className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingClientPlan ? 'Saving...' : 'Save Client Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD NEW CLIENT BUSINESS MODAL */}
      {newClientModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Add Client Business</h3>
              <button
                type="button"
                onClick={() => setNewClientModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClientOrg} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Business Name</label>
                <input
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="e.g. Rift Electronics Ltd"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Owner Email</label>
                <input
                  type="email"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  placeholder="owner@client.com"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">Phone Number</label>
                <input
                  value={newClientPhone}
                  onChange={(e) => setNewClientPhone(e.target.value)}
                  placeholder="07XX XXX XXX"
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Initial Plan</label>
                  <select
                    value={newClientPlanId}
                    onChange={(e) => setNewClientPlanId(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Unassigned</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(p.price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">Status</label>
                  <select
                    value={newClientStatus}
                    onChange={(e) => setNewClientStatus(e.target.value as SubscriptionStatus)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="past_due">Past Due</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setNewClientModalOpen(false)}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNewClient}
                  className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingNewClient ? 'Creating...' : 'Create Client'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE PLAN CONFIRMATION MODAL */}
      {confirmDeletePlan && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Delete Payment Plan</h3>
            <p className="text-sm text-slate-600">
              Delete <span className="font-semibold text-slate-900">{confirmDeletePlan.name}</span>? Clients currently assigned to it will keep their recorded plan name until reassigned.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeletePlan(null)}
                className="h-9 px-3.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePlan}
                className="h-9 px-3.5 rounded-lg bg-red-700 hover:bg-red-800 text-white text-sm font-medium cursor-pointer"
              >
                Delete Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIRESTORE RULES MODAL */}
      {showRulesModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-700" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Firebase Firestore Rules for Super Admin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              If your Firebase Console rules block cross-organization access, paste these rules under{' '}
              <span className="font-semibold">Firestore Database → Rules</span> in project{' '}
              <span className="font-mono">edd2-58582</span> so <span className="font-mono">{SUPER_ADMIN_EMAIL}</span> can read and edit all client payment plans.
            </p>
            <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto max-h-80">
              {FIRESTORE_RULES_SNIPPET}
            </pre>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={copyRules}
                className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{copiedRules ? 'Copied!' : 'Copy Rules'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="h-9 px-3.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
