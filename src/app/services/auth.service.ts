// services/auth.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { 
  Auth, 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  ConfirmationResult,
  User as FirebaseUser,
  signOut,
  onAuthStateChanged
} from '@angular/fire/auth';
import { 
  Firestore, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  onSnapshot
} from '@angular/fire/firestore';

export interface User {
  uid: string;
  email?: string;
  phoneNumber: string;
  displayName: string;
  isOnline: boolean;
  lastSeen: any;
  createdAt: any;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private authSubject = new BehaviorSubject<User | null>(null);
  public authState$ = this.authSubject.asObservable();
  
  private recaptchaVerifier: RecaptchaVerifier | null = null;
  private confirmationResult: ConfirmationResult | null = null;
  
  currentUser: User | null = null;

  constructor(
    private auth: Auth,
    private firestore: Firestore
  ) {
    this.initAuthListener();
  }

  private initAuthListener() {
    onAuthStateChanged(this.auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        const user = await this.getUserData(firebaseUser.uid);
        this.currentUser = user;
        this.authSubject.next(user);
      } else {
        this.currentUser = null;
        this.authSubject.next(null);
      }
    });
  }

  async initRecaptcha(elementId: string): Promise<void> {
    try {
      this.recaptchaVerifier = new RecaptchaVerifier(this.auth, elementId, {
        size: 'normal',
        callback: () => {
          console.log('reCAPTCHA solved');
        },
        'expired-callback': () => {
          console.log('reCAPTCHA expired');
          this.recaptchaVerifier = null;
        }
      });
      
      await this.recaptchaVerifier.render();
    } catch (error) {
      console.error('Error initializing reCAPTCHA:', error);
      throw new Error('Failed to initialize reCAPTCHA. Please refresh and try again.');
    }
  }

  async sendOTP(phoneNumber: string): Promise<void> {
    try {
      if (!this.recaptchaVerifier) {
        throw new Error('reCAPTCHA not initialized');
      }
      const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber : '+' + phoneNumber;
      
      console.log('Sending OTP to:', formattedNumber);
      
      this.confirmationResult = await signInWithPhoneNumber(
        this.auth, 
        formattedNumber, 
        this.recaptchaVerifier
      );
      
      console.log('OTP sent successfully');
    } catch (error: any) {
      console.error('Error sending OTP:', error);

      if (this.recaptchaVerifier) {
        this.recaptchaVerifier.clear();
        this.recaptchaVerifier = null;
      }
      if (error.code === 'auth/invalid-phone-number') {
        throw new Error('Invalid phone number format');
      } else if (error.code === 'auth/too-many-requests') {
        throw new Error('Too many attempts. Please try again later');
      } else if (error.code === 'auth/quota-exceeded') {
        throw new Error('SMS quota exceeded. Please try again later');
      } else {
        throw new Error('Failed to send OTP. Please try again');
      }
    }
  }

  async verifyOTP(otp: string, displayName?: string): Promise<User> {
    try {
      if (!this.confirmationResult) {
        throw new Error('No OTP session found. Please request OTP again');
      }

      const userCredential = await this.confirmationResult.confirm(otp);
      const firebaseUser = userCredential.user;

      if (!firebaseUser) {
        throw new Error('Authentication failed');
      }

      const userData: User = {
        uid: firebaseUser.uid,
        phoneNumber: firebaseUser.phoneNumber || '',
        displayName: displayName || firebaseUser.phoneNumber?.slice(-4) || 'User',
        isOnline: true,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp()
      };

      await this.createOrUpdateUser(userData);

      this.confirmationResult = null;
      if (this.recaptchaVerifier) {
        this.recaptchaVerifier.clear();
        this.recaptchaVerifier = null;
      }

      return userData;
    } catch (error: any) {
      console.error('Error verifying OTP:', error);
      
      if (error.code === 'auth/invalid-verification-code') {
        throw new Error('Invalid OTP. Please check and try again');
      } else if (error.code === 'auth/code-expired') {
        throw new Error('OTP has expired. Please request a new one');
      } else {
        throw new Error('Failed to verify OTP. Please try again');
      }
    }
  }

  private async createOrUpdateUser(userData: User): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', userData.uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        // Update existing user
        await updateDoc(userRef, {
          isOnline: true,
          lastSeen: serverTimestamp(),
          displayName: userData.displayName
        });
      } else {
        // Create new user
        await setDoc(userRef, userData);
      }
    } catch (error) {
      console.error('Error creating/updating user:', error);
      throw new Error('Failed to save user data');
    }
  }

  private async getUserData(uid: string): Promise<User | null> {
    try {
      const userRef = doc(this.firestore, 'users', uid);
      const userDoc = await getDoc(userRef);

      if (userDoc.exists()) {
        return userDoc.data() as User;
      }
      return null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }

  async getCurrentUser(): Promise<User | null> {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(this.auth, async (firebaseUser) => {
        unsubscribe();
        if (firebaseUser) {
          const userData = await this.getUserData(firebaseUser.uid);
          resolve(userData);
        } else {
          resolve(null);
        }
      });
    });
  }

  async setUserOnlineStatus(isOnline: boolean): Promise<void> {
    try {
      if (this.currentUser) {
        const userRef = doc(this.firestore, 'users', this.currentUser.uid);
        await updateDoc(userRef, {
          isOnline,
          lastSeen: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('Error updating online status:', error);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.setUserOnlineStatus(false);
      await signOut(this.auth);
      this.currentUser = null;
    } catch (error) {
      console.error('Error signing out:', error);
      throw new Error('Failed to sign out');
    }
  }

  // Get online users for potential calls
  getOnlineUsers(): Observable<User[]> {
    return new Observable(observer => {
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where('isOnline', '==', true));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users: User[] = [];
        snapshot.forEach(doc => {
          const userData = doc.data() as User;
          // Exclude current user
          if (userData.uid !== this.currentUser?.uid) {
            users.push(userData);
          }
        });
        observer.next(users);
      }, (error) => {
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  // Cleanup on app close/refresh
  async cleanup(): Promise<void> {
    await this.setUserOnlineStatus(false);
    if (this.recaptchaVerifier) {
      this.recaptchaVerifier.clear();
    }
  }

  // Add this to your auth service for debugging
async debugAuthToken(): Promise<void> {
  try {
    const user = this.auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      const decodedToken = await user.getIdTokenResult();
      
      console.log('🔐 Auth Token Debug:', {
        uid: user.uid,
        email: user.email,
        phoneNumber: user.phoneNumber,
        tokenClaims: decodedToken.claims,
        tokenExpiration: new Date(decodedToken.expirationTime),
        isTokenExpired: new Date() > new Date(decodedToken.expirationTime)
      });
    } else {
      console.log('❌ No authenticated user');
    }
  } catch (error) {
    console.error('❌ Auth token error:', error);
  }
}
}