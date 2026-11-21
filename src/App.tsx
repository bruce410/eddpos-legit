import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { auth, db, serverTimestamp } from './lib/firebase';
import { AuthView } from './components/AuthView';
import { AdminPortal } from './components/AdminPortal';
import { PosWorkspace } from './components/PosWorkspace';
import { CompleteProfileView } from './components/CompleteProfileView';
import { SUPER_ADMIN_EMAIL, type Organization, type UserProfile } from './types/pos';

type ViewMode = 'adminPortal' | 'pos';

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [setupNotice, setSetupNotice] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('pos');
  const [authAlert, setAuthAlert] = useState<{
    message: string;
    type: 'success' | 'danger' | 'warning';
  } | null>(null);

  const registrationInProgressRef = useRef(false);

  const initializeSession = useCallback(async (user: User) => {
    const email = (user.email || '').trim().toLowerCase();
    const isSuperAdmin = email === SUPER_ADMIN_EMAIL;

    try {
      let loadedProfile: UserProfile | null = null;
      let loadedOrg: Organization | null = null;

      // 1. Primary lookup: users/{uid}
      const userSnap = await getDoc(doc(db, 'users', user.uid));
      let rawUser: (Partial<UserProfile> & { name?: string }) | null = userSnap.exists()
        ? (userSnap.data() as Partial<UserProfile> & { name?: string })
        : null;

      // 2. Fallback lookup: find profile by email if doc ID was not uid
      if (!rawUser && email) {
        try {
          const emailSnap = await getDocs(
            query(collection(db, 'users'), where('email', '==', email))
          );
          if (!emailSnap.empty) {
            rawUser = emailSnap.docs[0].data() as Partial<UserProfile> & { name?: string };
            // Best-effort sync to users/{uid} so future logins are instant
            await setDoc(doc(db, 'users', user.uid), {
              user: rawUser.user || rawUser.name || email.split('@')[0] || 'Staff',
              email,
              role: rawUser.role === 'admin' ? 'admin' : 'sales',
              orgId: rawUser.orgId || '',
              createdAt: rawUser.createdAt || serverTimestamp(),
            }).catch(() => {});
          }
        } catch {
          // Ignore if Firestore rules disallow querying users by email
        }
      }

      // 3. Fallback lookup: find an organization owned by uid or email
      if ((!rawUser || !rawUser.orgId) && (user.uid || email)) {
        try {
          let foundOrgDoc = null;
          const byOwnerSnap = await getDocs(
            query(collection(db, 'organizations'), where('ownerId', '==', user.uid))
          );
          if (!byOwnerSnap.empty) {
            foundOrgDoc = byOwnerSnap.docs[0];
          } else if (email) {
            const byEmailSnap = await getDocs(
              query(collection(db, 'organizations'), where('ownerEmail', '==', email))
            );
            if (!byEmailSnap.empty) {
              foundOrgDoc = byEmailSnap.docs[0];
            }
          }

          if (foundOrgDoc) {
            const recoveredProfile: Omit<UserProfile, 'id'> = {
              user: rawUser?.user || rawUser?.name || email.split('@')[0] || 'Admin',
              email,
              role: 'admin',
              orgId: foundOrgDoc.id,
              createdAt: serverTimestamp(),
            };
            await setDoc(doc(db, 'users', user.uid), recoveredProfile).catch(() => {});
            rawUser = recoveredProfile;
          }
        } catch {
          // Ignore if Firestore rules disallow querying organizations
        }
      }

      if (rawUser) {
        const userData: Omit<UserProfile, 'id'> = {
          user: rawUser.user || rawUser.name || rawUser.email?.split('@')[0] || email.split('@')[0] || 'Staff',
          email: rawUser.email || user.email || '',
          role: rawUser.role === 'admin' ? 'admin' : 'sales',
          orgId: rawUser.orgId || '',
          createdBy: rawUser.createdBy,
          createdAt: rawUser.createdAt,
        };
        if (userData.orgId) {
          const orgSnap = await getDoc(doc(db, 'organizations', userData.orgId));
          if (orgSnap.exists()) {
            loadedProfile = { id: user.uid, ...userData };
            loadedOrg = { id: orgSnap.id, ...(orgSnap.data() as Omit<Organization, 'id'>) };
          }
        }
      }

      if (isSuperAdmin) {
        setFirebaseUser(user);
        setCurrentUser(loadedProfile);
        setCurrentOrg(loadedOrg);
        setNeedsProfileSetup(false);
        setSetupNotice(null);
        setViewMode('adminPortal');
        setAuthAlert(null);
        return;
      }

      // If login is valid in Firebase Auth but business profile/org doesn't exist yet,
      // route to CompleteProfileView instead of throwing an error & signing them out!
      if (!loadedProfile || !loadedOrg) {
        setFirebaseUser(user);
        setCurrentUser(null);
        setCurrentOrg(null);
        setNeedsProfileSetup(true);
        setSetupNotice(
          rawUser && !loadedOrg
            ? 'Your previous business link could not be found. Create or link a business profile below.'
            : null
        );
        setAuthAlert(null);
        return;
      }

      setFirebaseUser(user);
      setCurrentUser(loadedProfile);
      setCurrentOrg(loadedOrg);
      setNeedsProfileSetup(false);
      setSetupNotice(null);
      setViewMode('pos');
      setAuthAlert(null);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error.code === 'permission-denied') {
        setAuthAlert({
          message: 'Firestore permission denied. Check your Firebase security rules.',
          type: 'danger',
        });
        if (!registrationInProgressRef.current) {
          await signOut(auth).catch(() => {});
        }
        setFirebaseUser(null);
        setCurrentUser(null);
        setCurrentOrg(null);
        setNeedsProfileSetup(false);
      } else {
        setFirebaseUser(user);
        setCurrentUser(null);
        setCurrentOrg(null);
        setNeedsProfileSetup(true);
        setSetupNotice(error.message || 'Complete your business profile to continue.');
      }
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (registrationInProgressRef.current) return;
      if (user) {
        setInitializing(true);
        initializeSession(user);
      } else {
        setFirebaseUser(null);
        setCurrentUser(null);
        setCurrentOrg(null);
        setNeedsProfileSetup(false);
        setInitializing(false);
      }
    });
    return () => unsubscribe();
  }, [initializeSession]);

  const handleSignOut = async () => {
    await signOut(auth);
    setFirebaseUser(null);
    setCurrentUser(null);
    setCurrentOrg(null);
    setNeedsProfileSetup(false);
    setAuthAlert({ message: 'Logged out successfully.', type: 'success' });
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-blue-700 border-t-transparent animate-spin" />
          <span className="text-sm font-medium text-slate-700">Loading EDDMOBI POS...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <AuthView
        externalAlert={authAlert}
        onRegistrationStart={() => {
          registrationInProgressRef.current = true;
        }}
        onRegistrationComplete={async () => {
          registrationInProgressRef.current = false;
          if (auth.currentUser) {
            await initializeSession(auth.currentUser);
          }
        }}
        onRegistrationFail={() => {
          registrationInProgressRef.current = false;
        }}
      />
    );
  }

  const email = (firebaseUser.email || '').trim().toLowerCase();
  const isSuperAdmin = email === SUPER_ADMIN_EMAIL;

  if (isSuperAdmin && viewMode === 'adminPortal') {
    return (
      <AdminPortal
        userEmail={firebaseUser.email || SUPER_ADMIN_EMAIL}
        hasOwnPosOrg={Boolean(currentUser && currentOrg)}
        onSwitchToPos={() => {
          if (currentUser && currentOrg) setViewMode('pos');
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  if (needsProfileSetup && !isSuperAdmin) {
    return (
      <CompleteProfileView
        uid={firebaseUser.uid}
        email={firebaseUser.email || ''}
        initialIssue={setupNotice}
        onProfileCreated={async () => {
          if (auth.currentUser) {
            await initializeSession(auth.currentUser);
          }
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  if (currentUser && currentOrg) {
    return (
      <PosWorkspace
        currentUser={currentUser}
        currentOrg={currentOrg}
        isSuperAdmin={isSuperAdmin}
        onSwitchToAdminPortal={() => setViewMode('adminPortal')}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <AuthView
      externalAlert={authAlert}
      onRegistrationStart={() => {
        registrationInProgressRef.current = true;
      }}
      onRegistrationComplete={async () => {
        registrationInProgressRef.current = false;
        if (auth.currentUser) {
          await initializeSession(auth.currentUser);
        }
      }}
      onRegistrationFail={() => {
        registrationInProgressRef.current = false;
      }}
    />
  );
}
