import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getDatabase, ref, onValue, set, onDisconnect, update } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error("Error initializing Firebase:", error);
  throw new Error("Failed to initialize Firebase. Please check your configuration.");
}

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore with persistence
export const db = getFirestore(app);
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence failed to enable. Multiple tabs might be open.');
    } else if (err.code === 'unimplemented') {
      console.warn('Browser doesn\'t support persistence');
    }
  });

// Initialize Realtime Database
export const rdb = getDatabase(app);

// Set persistent auth state
setPersistence(auth, browserLocalPersistence)
  .catch((error) => {
    console.error("Auth persistence error:", error);
  });

// Authentication functions
export async function signInAnonymousUser() {
  try {
    const userCredential = await signInAnonymously(auth);
    if (!userCredential.user) {
      throw new Error('Failed to create anonymous user');
    }

    // Initialize presence tracking for the new user
    initPresence(userCredential.user.uid);

    return userCredential.user;
  } catch (error) {
    console.error("Error signing in anonymously:", error);
    throw new Error('Failed to authenticate anonymously. Please try again.');
  }
}

export async function loginWithEmailPassword(email: string, password: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error: any) {
    console.error("Error logging in:", error);
    // Provide more user-friendly error messages
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      throw new Error('Invalid email or password');
    }
    throw error;
  }
}

export async function registerWithEmailPassword(email: string, password: string) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error: any) {
    console.error("Error registering:", error);
    // Provide more user-friendly error messages
    if (error.code === 'auth/email-already-in-use') {
      throw new Error('Email is already registered');
    }
    throw error;
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
}

// Presence tracking function
export const initPresence = (uid: string) => {
  const presenceRef = ref(rdb, `status/${uid}`);

  onValue(ref(rdb, '.info/connected'), (snapshot) => {
    if (snapshot.val()) {
      set(presenceRef, true);
      onDisconnect(presenceRef).set(false);
    }
  });
};

// Function to manage voice call metadata in Realtime Database (optional)
export const updateCallStatus = async (callerId: string, receiverId: string, status: 'request' | 'accepted' | 'rejected' | 'ended' | 'busy') => {
  try {
    const callRef = ref(rdb, `calls/${callerId}/${receiverId}`);
    await update(callRef, {
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating call status:", error);
    throw new Error('Failed to update call status in Firebase.');
  }
};

// Function to get call status (optional)
export const getCallStatus = (callerId: string, receiverId: string, callback: (status: string | null) => void) => {
  const callRef = ref(rdb, `calls/${callerId}/${receiverId}/status`);
  return onValue(callRef, (snapshot) => {
    callback(snapshot.val() || null);
  }, (error) => {
    console.error("Error fetching call status:", error);
    callback(null);
  });
};