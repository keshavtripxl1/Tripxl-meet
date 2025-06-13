// services/invitation.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  Firestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
  getDocs
} from '@angular/fire/firestore';
import { AuthService, User } from './auth.service';

export interface Invitation {
  id?: string;
  fromUserId: string;
  toUserId: string;
  fromUserName: string;
  fromUserPhone?: string;
  roomId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  timestamp: any;
  expiresAt: any;
}

@Injectable({
  providedIn: 'root'
})
export class InvitationService {
  private incomingInvitationSubject = new BehaviorSubject<Invitation | null>(null);
  public incomingInvitation$ = this.incomingInvitationSubject.asObservable();
  
  private responseSubject = new BehaviorSubject<{invitationId: string, status: string} | null>(null);
  public invitationResponse$ = this.responseSubject.asObservable();

  constructor(
    private firestore: Firestore,
    private authService: AuthService
  ) {
    this.setupInvitationListener();
    this.cleanupExpiredInvitations();
  }

  // Send invitation
  async sendInvitation(toUser: User, roomId: string): Promise<string> {
    const currentUser = this.authService.currentUser;
    console.log('🔐 Auth Debug:', {
        currentUser: currentUser,
        isAuthenticated: !!currentUser,
        uid: currentUser?.uid,
        authState: this.authService.authState$
    });
    if (!currentUser) {
      throw new Error('No authenticated user');
    }
    
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() + 5); // 5 minutes from now

    const invitationData: Omit<Invitation, 'id'> = {
      fromUserId: currentUser.uid,
      toUserId: toUser.uid,
      fromUserName: currentUser.displayName,
      fromUserPhone: currentUser.phoneNumber,
      roomId: roomId,
      status: 'pending',
      timestamp: serverTimestamp(),
      expiresAt: expirationTime
    };

    try {
      const docRef = await addDoc(collection(this.firestore, 'invitations'), invitationData);
      console.log('Invitation sent:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error sending invitation:', error);
      throw new Error('Failed to send invitation');
    }
  }

  // Listen for incoming invitations
  private setupInvitationListener(): void {
    this.authService.authState$.subscribe(user => {
      if (user) {
        const invitationsRef = collection(this.firestore, 'invitations');
        const q = query(
          invitationsRef,
          where('toUserId', '==', user.uid),
          where('status', '==', 'pending')
        );

        onSnapshot(q, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const invitation: Invitation = {
                id: change.doc.id,
                ...change.doc.data()
              } as Invitation;
              
              // Check if not expired
              const now = new Date();
              const expiresAt = invitation.expiresAt.toDate ? invitation.expiresAt.toDate() : new Date(invitation.expiresAt);
              
              if (now < expiresAt) {
                console.log('New invitation received:', invitation);
                this.incomingInvitationSubject.next(invitation);
              } else {
                // Mark as expired
                this.updateInvitationStatus(invitation.id!, 'expired');
              }
            }
          });
        });
      }
    });
  }

  // Respond to invitation
  async respondToInvitation(invitationId: string, accepted: boolean): Promise<string | null> {
    try {
      const status = accepted ? 'accepted' : 'declined';
      await this.updateInvitationStatus(invitationId, status);
      
      if (accepted) {
        // Get the invitation to return room ID
        const invitationRef = doc(this.firestore, 'invitations', invitationId);
        const invitationDoc = await getDocs(
          query(collection(this.firestore, 'invitations'), where('__name__', '==', invitationId))
        );
        
        if (!invitationDoc.empty) {
          const invitation = invitationDoc.docs[0].data() as Invitation;
          return invitation.roomId;
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error responding to invitation:', error);
      throw new Error('Failed to respond to invitation');
    }
  }

  // Listen for invitation responses (for the inviter)
  listenForInvitationResponse(invitationId: string): Observable<string> {
    return new Observable(observer => {
      const invitationRef = doc(this.firestore, 'invitations', invitationId);
      
      const unsubscribe = onSnapshot(invitationRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
          const invitation = docSnapshot.data() as Invitation;
          
          if (invitation.status === 'accepted') {
            observer.next('accepted');
            this.responseSubject.next({invitationId, status: 'accepted'});
          } else if (invitation.status === 'declined') {
            observer.next('declined');
            this.responseSubject.next({invitationId, status: 'declined'});
          } else if (invitation.status === 'expired') {
            observer.next('expired');
            this.responseSubject.next({invitationId, status: 'expired'});
          }
        }
      });

      return () => unsubscribe();
    });
  }

  // Update invitation status
  private async updateInvitationStatus(invitationId: string, status: string): Promise<void> {
    const invitationRef = doc(this.firestore, 'invitations', invitationId);
    await updateDoc(invitationRef, { status });
  }

  // Clear current invitation
  clearIncomingInvitation(): void {
    this.incomingInvitationSubject.next(null);
  }

  // Cleanup expired invitations
  private async cleanupExpiredInvitations(): Promise<void> {
    try {
      const now = new Date();
      const invitationsRef = collection(this.firestore, 'invitations');
      const q = query(
        invitationsRef,
        where('status', '==', 'pending')
      );

      const snapshot = await getDocs(q);
      const expiredInvitations: string[] = [];

      snapshot.forEach(doc => {
        const invitation = doc.data() as Invitation;
        const expiresAt = invitation.expiresAt.toDate ? invitation.expiresAt.toDate() : new Date(invitation.expiresAt);
        
        if (now > expiresAt) {
          expiredInvitations.push(doc.id);
        }
      });

      // Update expired invitations
      for (const invitationId of expiredInvitations) {
        await this.updateInvitationStatus(invitationId, 'expired');
      }

      console.log(`Cleaned up ${expiredInvitations.length} expired invitations`);
    } catch (error) {
      console.error('Error cleaning up expired invitations:', error);
    }
  }
}