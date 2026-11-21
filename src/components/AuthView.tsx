import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, setDoc, collection } from 'firebase/firestore';
import { Eye, EyeOff, ArrowRight, ShieldCheck, Store, BarChart3, Receipt } from 'lucide-react';
import { auth, db, serverTimestamp } from '../lib/firebase';
import { SUPER_ADMIN_EMAIL } from '../types/pos';

interface AuthViewProps {
  externalAlert: { message: string; type: 'success' | 'danger' | 'warning' } | null;
  onRegistrationStart: () => void;
  onRegistrationComplete: (uid: string) => Promise<void>;
  onRegistrationFail: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  externalAlert,
  onRegistrationStart,
  onRegistrationComplete,
  onRegistrationFail,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPw, setShowLoginPw] = useState(false);

  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizPassword, setBizPassword] = useState('');
  const [showBizPw, setShowBizPw] = useState(false);

  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<{ message: string; type: 'success' | 'danger' | 'warning' } | null>(null);

  const activeAlert = alert || externalAlert;

  const notify = (message: string, type: 'success' | 'danger' | 'warning') => {
    setAlert({ message, type });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    if (!email || !loginPassword) {
      notify('Please enter your email address and password.', 'danger');
      return;
    }

    setBusy(true);
    setAlert(null);
    try {
      await signInWithEmailAndPassword(auth, email, loginPassword);
      // Auth state listener in App.tsx handles routing
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      let msg = error.message || 'Sign in failed. Please check your credentials.';
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        msg = 'Incorrect email or password. Please verify and try again.';
      } else if (error.code === 'auth/user-not-found') {
        msg = 'No account found with this email address.';
      } else if (error.code === 'auth/too-many-requests') {
        msg = 'Too many failed attempts. Please wait a few minutes or reset your password.';
      }
      notify(msg, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = loginEmail.trim().toLowerCase();
    if (!email) {
      notify('Enter your registered email address first, then click Forgot password.', 'warning');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notify('Please enter a valid email address.', 'danger');
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      notify(
        `If an account exists for ${email}, a secure password-reset link has been sent. Check your inbox and spam folder.`,
        'success'
      );
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      let msg = 'Unable to send reset email right now. Please try again.';
      if (error.code === 'auth/user-not-found') {
        msg = 'No EDDMOBI POS account was found for that email address.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'That email address is not valid.';
      } else if (error.code === 'auth/too-many-requests') {
        msg = 'Too many reset requests. Wait a few minutes before trying again.';
      }
      notify(msg, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = bizName.trim();
    const email = bizEmail.trim().toLowerCase();
    if (!name || !email || !bizPassword) {
      notify('Please fill in business name, email, and password.', 'danger');
      return;
    }
    if (bizPassword.length < 6) {
      notify('Password must be at least 6 characters.', 'warning');
      return;
    }

    setBusy(true);
    setAlert(null);
    onRegistrationStart();

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, bizPassword);
      const uid = cred.user.uid;
      const orgRef = doc(collection(db, 'organizations'));
      await setDoc(orgRef, {
        name,
        ownerId: uid,
        ownerEmail: email,
        subscriptionStatus: 'trial',
        planName: 'Trial',
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', uid), {
        user: email.split('@')[0],
        email,
        role: 'admin',
        orgId: orgRef.id,
        createdAt: serverTimestamp(),
      });
      setBizName('');
      setBizEmail('');
      setBizPassword('');
      await onRegistrationComplete(uid);
    } catch (err: unknown) {
      onRegistrationFail();
      const error = err as { code?: string; message?: string };
      let msg = error.message || 'Registration failed.';
      if (error.code === 'auth/email-already-in-use') {
        msg = 'This email already has an account. Please sign in instead.';
      } else if (error.code === 'auth/weak-password') {
        msg = 'Choose a stronger password with at least 6 characters.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Enter a valid email address.';
      } else if (error.code === 'permission-denied') {
        msg = 'Firestore rules blocked business registration. Check organizations and users rules.';
      }
      notify(msg, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const isSuperAdminEmailTyped = loginEmail.trim().toLowerCase() === SUPER_ADMIN_EMAIL;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      {/* Top Bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            EDDMOBI POS
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm text-slate-600">
            <span className="whitespace-nowrap">Kajiado Town</span>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">0722540912</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setAlert(null);
                setMode(mode === 'login' ? 'register' : 'login');
              }}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {mode === 'login' ? 'Register Business' : 'Staff Sign In'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Narrative */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider uppercase text-blue-700">
                Retail Operations & Billing
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 text-balance leading-tight">
                Point of sale built for daily stock, sales, and client subscriptions.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Track inventory in real time, issue printed receipts, analyze net profit trends, and manage client payment plans from one unified platform.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
                <Store className="w-4 h-4 text-blue-700" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-900">Inventory & Purchases</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Real-time stock alerts, supplier receipts, and weighted buying costs.
                </p>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
                <Receipt className="w-4 h-4 text-blue-700" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-900">Sales & Invoicing</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Cash, M-Pesa, cheque, and credit sales with instant printable invoices.
                </p>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
                <BarChart3 className="w-4 h-4 text-blue-700" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-900">Net Profit Analytics</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Weekly, monthly, and annual net profit trends after recorded expenses.
                </p>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-700" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-900">Client Plan Control</div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Platform admin portal for assigning, editing, and approving client plans.
                </p>
              </div>
            </div>
          </div>

          {/* Right Auth Form */}
          <div className="lg:col-span-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm max-w-md mx-auto lg:ml-auto lg:mr-0">
              {activeAlert && (
                <div
                  role="alert"
                  className={`mb-5 px-4 py-3 rounded-lg border text-sm ${
                    activeAlert.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : activeAlert.type === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {activeAlert.message}
                </div>
              )}

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Sign in to EDDMOBI POS</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Staff, business admins, and platform administrators sign in here.
                    </p>
                  </div>

                  {isSuperAdminEmailTyped && (
                    <div className="px-3.5 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                      <span>Platform Super Admin recognized. Signing in opens the Client Payment Plans Admin Portal.</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label htmlFor="loginEmail" className="block text-sm font-medium text-slate-700">
                      Email address
                    </label>
                    <input
                      id="loginEmail"
                      type="email"
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="name@business.com"
                      className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="loginPassword" className="block text-sm font-medium text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={busy}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline cursor-pointer disabled:opacity-50"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="loginPassword"
                        type={showLoginPw ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full h-11 pl-3.5 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPw(!showLoginPw)}
                        aria-label={showLoginPw ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        {showLoginPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    <span>{busy ? 'Signing in...' : 'Sign In'}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <p className="text-center text-sm text-slate-600 pt-1">
                    New business?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAlert(null);
                        setMode('register');
                      }}
                      className="font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Register Business
                    </button>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-5">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Register your business</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Create an organization account to start managing stock and sales.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="bizName" className="block text-sm font-medium text-slate-700">
                      Business Name
                    </label>
                    <input
                      id="bizName"
                      type="text"
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      placeholder="e.g. Eddmobi Electronics"
                      className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="bizEmail" className="block text-sm font-medium text-slate-700">
                      Admin Email
                    </label>
                    <input
                      id="bizEmail"
                      type="email"
                      autoComplete="email"
                      value={bizEmail}
                      onChange={(e) => setBizEmail(e.target.value)}
                      placeholder="admin@business.com"
                      className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="bizPassword" className="block text-sm font-medium text-slate-700">
                      Password (min 6 characters)
                    </label>
                    <div className="relative">
                      <input
                        id="bizPassword"
                        type={showBizPw ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={bizPassword}
                        onChange={(e) => setBizPassword(e.target.value)}
                        placeholder="Create a strong password"
                        className="w-full h-11 pl-3.5 pr-11 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowBizPw(!showBizPw)}
                        aria-label={showBizPw ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        {showBizPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full h-11 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    <span>{busy ? 'Creating Account...' : 'Create Business Account'}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <p className="text-center text-sm text-slate-600 pt-1">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAlert(null);
                        setMode('login');
                      }}
                      className="font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Sign In
                    </button>
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>EDDMOBI POS · Point of Sale & Client Subscription Management</span>
          <span>Support: 0722540912</span>
        </div>
      </footer>
    </div>
  );
};
