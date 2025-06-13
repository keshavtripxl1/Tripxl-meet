// components/lobby.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, User } from '../../services/auth.service';
import { VideoCallService } from '../../services/video-call.service';
import { InvitationService, Invitation } from '../../services/invitation.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-lobby',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lobby.component.html',
  styleUrls: ['./lobby.component.css']
})
export class LobbyComponent implements OnInit, OnDestroy {
  @Input() currentUser: User | null = null;
  @Output() joinRoom = new EventEmitter<string>();
  @Output() createRoom = new EventEmitter<void>();

  meetingId = '';
  onlineUsers: User[] = [];
  errorMessage = '';
  successMessage = '';
  
  // Invitation modal properties
  showInvitationModal = false;
  currentInvitation: Invitation | null = null;
  
  // Loading states
  loading = false;
  invitingUser: string | null = null;
  
  private subscriptions: Subscription[] = [];

  constructor(
    private authService: AuthService,
    private videoCallService: VideoCallService,
    private invitationService: InvitationService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadOnlineUsers();
    this.setupInvitationListener();
    this.setUserOnlineStatus(true);
    
    // Set current user in video service
    if (this.currentUser) {
      this.videoCallService.setCurrentUser(this.currentUser);
    } else {
      // Get current user from auth service
      const authSub = this.authService.authState$.subscribe(user => {
        if (user) {
          this.currentUser = user;
          this.videoCallService.setCurrentUser(user);
        }
      });
      this.subscriptions.push(authSub);
    }
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.setUserOnlineStatus(false);
  }

  private setUserOnlineStatus(isOnline: boolean) {
    if (this.currentUser) {
      this.authService.setUserOnlineStatus(isOnline);
    }
  }

  private loadOnlineUsers() {
    const onlineUsersSub = this.authService.getOnlineUsers().subscribe({
      next: (users) => {
        this.onlineUsers = users;
        console.log('👥 Online users loaded:', users);
      },
      error: (error) => {
        console.error('Error loading online users:', error);
        this.setError('Failed to load online users');
      }
    });
    this.subscriptions.push(onlineUsersSub);
  }

  private setupInvitationListener() {
    const invitationSub = this.invitationService.incomingInvitation$.subscribe(invitation => {
      if (invitation) {
        console.log('📞 Received invitation:', invitation);
        this.currentInvitation = invitation;
        this.showInvitationModal = true;
      }
    });
    this.subscriptions.push(invitationSub);
  }

  createMeeting() {
    this.setSuccess('Creating new meeting...');
    const roomId = this.videoCallService.generateRoomId();
    
    setTimeout(() => {
      // Navigate to video component as host
      this.router.navigate(['/call',roomId], { 
        queryParams: { host: 'true' } 
      });
    }, 500);
  }

  joinMeeting() {
    if (!this.meetingId.trim()) {
      this.setError('Please enter a meeting ID');
      return;
    }
    if (this.meetingId.length < 6) {
      this.setError('Meeting ID must be at least 6 characters');
      return;
    }

    this.setSuccess('Joining meeting...');
    setTimeout(() => {
      // Navigate to video component as guest
      this.router.navigate(['/call', this.meetingId.trim()], { 
        queryParams: { host: 'false' } 
      });
    }, 500);
  }

  async inviteUser(user: User) {
    if (this.loading || this.invitingUser === user.uid) return;

    try {
      this.invitingUser = user.uid;
      this.loading = true;

      const currentUser = this.authService.currentUser;
      if (!currentUser) {
        this.setError('You must be logged in to send invitations');
        return;
      }
      
      // Make sure video service has current user
      this.videoCallService.setCurrentUser(currentUser);
      
      this.setSuccess(`Inviting ${user.displayName || 'User'} to a meeting...`);
      console.log('📞 Inviting user:', user);
      
      await this.videoCallService.inviteUserToCall(user);
      
      this.setSuccess(`Invitation sent to ${user.displayName}! Waiting for response...`);
      
      // The navigation will happen automatically when invitation is accepted
      // through the video service invitation response listener
      
    } catch (error) {
      console.error('❌ Error inviting user:', error);
      this.setError('Failed to send invitation. Please try again.');
    } finally {
      this.loading = false;
      this.invitingUser = null;
    }
  }

  // Accept invitation
  async acceptInvitation() {
    if (!this.currentInvitation) return;

    try {
      console.log('✅ Accepting invitation:', this.currentInvitation);
      
      const roomId = await this.invitationService.respondToInvitation(
        this.currentInvitation.id!,
        true
      );
      
      if (roomId) {
        // Navigate to video call as guest
        this.router.navigate(['/call',roomId], { 
          queryParams: { host: 'false', fromInvitation: 'true' } 
        });
      }
    } catch (error) {
      console.error('❌ Error accepting invitation:', error);
      this.setError('Failed to accept invitation. Please try again.');
    }
    
    this.closeInvitationModal();
  }

  // Decline invitation
  async declineInvitation() {
    if (!this.currentInvitation) return;

    try {
      console.log('❌ Declining invitation:', this.currentInvitation);
      
      await this.invitationService.respondToInvitation(
        this.currentInvitation.id!,
        false
      );
      
      this.setSuccess('Invitation declined');
    } catch (error) {
      console.error('❌ Error declining invitation:', error);
      this.setError('Failed to decline invitation');
    }
    
    this.closeInvitationModal();
  }

  // Close invitation modal
  closeInvitationModal() {
    this.showInvitationModal = false;
    this.currentInvitation = null;
    this.invitationService.clearIncomingInvitation();
  }

  // Check if user is being invited
  isInvitingUser(userId: string): boolean {
    return this.invitingUser === userId && this.loading;
  }

  async signOut() {
    try {
      await this.authService.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      this.setError('Failed to sign out');
    }
  }

  getUserInitials(): string {
    if (this.currentUser?.displayName) {
      return this.getInitials(this.currentUser.displayName);
    }
    return this.getInitials(this.currentUser?.phoneNumber || 'U');
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';
  }

  formatPhoneNumber(phoneNumber: string): string {
    // Simple phone number formatting
    if (phoneNumber.length > 10) {
      return phoneNumber.replace(/(\+\d{1,3})(\d{3})(\d{3})(\d{4})/, '$1 $2-$3-$4');
    }
    return phoneNumber;
  }

  private setError(message: string) {
    this.errorMessage = message;
    this.successMessage = '';
    // Auto-clear after 5 seconds
    setTimeout(() => this.clearError(), 5000);
  }

  private setSuccess(message: string) {
    this.successMessage = message;
    this.errorMessage = '';
    // Auto-clear after 3 seconds
    setTimeout(() => this.clearSuccess(), 3000);
  }

  clearError() {
    this.errorMessage = '';
  }

  clearSuccess() {
    this.successMessage = '';
  }
}