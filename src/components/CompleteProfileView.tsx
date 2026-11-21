import React, { useState } from 'react';
import { collection, doc, setDoc } from 'firebase/firestore';
import { LogOut, Store, ArrowRight } from 'lucide-react';
import { db, serverTimestamp } from '../lib/firebase';

interface CompleteProfileViewProps {
  uid: string;
  email: string;
  initialIssue?: string | null;
  onProfileCreated: () => Promise<void>;
  onSignOut: () => void;
}

export const CompleteProfileView: React.FC<CompleteProfileViewProps> = ({
  uid,
  email,
  initialIssue,
  onProfileCreated,
  onSignOut,
}) => {
  const [businessName, setBusinessName] = useState('');
  const [displayName, setDisplayName] = useState(email.split('@')[0] || 'Admin');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialIssue || null);

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedBiz = businessName.trim();
    const trimmedUser = (displayName.trim() || email.split('@')[0] || 'Admin').toLowerCase();

    if (!trimmedBiz) {
      setErrorMsg('Please enter your business name to continue.');
      return;
    }

    setBusy(true);
    setErrorMsg(null);
    try {
      const orgRef = doc(collection(db, 'organizations'));
      await setDoc(orgRef, {
        name: trimmedBiz,
        ownerId: uid,
        ownerEmail: email.toLowerCase(),
        subscriptionStatus: 'trial',
        planName: 'Trial',
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'users', uid), {
        user: trimmedUser,
        email: email.toLowerCase(),
        role: 'admin',
        orgId: orgRef.id,
        createdAt: serverTimestamp(),
      });

      await onProfileCreated();
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      let msg = error.message || 'Could not create business profile.';
      if (error.code === 'permission-denied') {
        msg =
          'Firestore rules blocked creating your business profile. Ensure signed-in users can write their own users/{uid} and organizations documents.';
      }
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
        <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
          EDDMOBI POS
        </div>
        <div className="hidden sm:block text-xs text-slate-500 truncate">
          Signed in as <span className="font-medium text-slate-800">{email}</span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="h-10 px-3.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>Logout</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="space-y-1.5">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 mb-3">
              <Store className="w-5 h-5" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Complete Your Business Setup</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your account (<span className="font-medium text-slate-800">{email}</span>) is signed in,
              but no business profile is linked yet. Create your business below to open EDDMOBI POS.
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
            >
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleCreateProfile} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="setupBizName" className="block text-xs font-medium text-slate-700">
                Business Name
              </label>
              <input
                id="setupBizName"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Eddmobi Electronics"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="setupDisplayName" className="block text-xs font-medium text-slate-700">
                Your Name
              </label>
              <input
                id="setupDisplayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Bruce"
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <span>{busy ? 'Creating Business...' : 'Create Business & Open POS'}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          <div className="pt-3 border-t border-slate-100 text-xs text-slate-500">
            Are you a sales staff member for an existing shop? Ask your shop admin to add your email under{' '}
            <span className="font-medium text-slate-700">Staff Users</span>, or click{' '}
            <button
              type="button"
              onClick={onSignOut}
              className="text-blue-700 font-medium hover:underline cursor-pointer"
            >
              Logout
            </button>{' '}
            to switch accounts.
          </div>
        </div>
      </main>
    </div>
  );
};
