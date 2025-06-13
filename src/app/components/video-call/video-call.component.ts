// components/video-call/video-call.component.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { User, AuthService } from '../../services/auth.service';
import { VideoCallService } from '../../services/video-call.service';
import { ChatService, ChatMessage } from '../../services/chat.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-video-call',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './video-call.component.html',
  styleUrls: ['./video-call.component.css'],
})
export class VideoCallComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('chatMessages') chatMessages!: ElementRef<HTMLDivElement>;

  // Support both @Input (for direct usage) and route params
  @Input() roomId?: string;
  @Input() currentUser?: User;
  @Output() leaveRoom = new EventEmitter<void>();

  // Route-based properties
  private routeRoomId?: string;
  private routeCurrentUser: User | null = null;
  isHost: boolean = false;
  fromInvitation: boolean = false;

  // Video call state
  connectionStatus = 'Connecting...';
  hasRemoteVideo = false;
  remoteUserName = '';
  isVideoOn = true;
  isAudioOn = true;
  isScreenSharing = false;

  // UI state
  showChat = false;
  localVideoPosition = { x: 20, y: 20 };
  isDragging = false;
  dragOffset = { x: 0, y: 0 };

  // Chat state
  messages: ChatMessage[] = [];
  newMessage = '';
  unreadMessages = 0;

  // Error handling
  errorMessage = '';
  successMessage = '';

  private subscriptions: Subscription[] = [];

  constructor(
    private videoCallService: VideoCallService,
    private chatService: ChatService,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  async ngOnInit() {
    // Get data from route params if not provided via @Input
    await this.initializeFromRoute();

    const finalRoomId = this.roomId || this.routeRoomId;
    const finalCurrentUser = this.currentUser || this.routeCurrentUser;

    if (!finalCurrentUser) {
      console.error('❌ VideoCallComponent: currentUser is required but not provided');
      this.setError('User authentication required');
      this.router.navigate(['/auth']);
      return;
    }

    if (!finalRoomId) {
      console.error('❌ VideoCallComponent: roomId is required but not provided');
      this.setError('Room ID is required');
      this.router.navigate(['/lobby']);
      return;
    }

    // Set the final values
    this.roomId = finalRoomId;
    this.currentUser = finalCurrentUser;

    console.log('🎥 VideoCallComponent initializing...', { 
      roomId: this.roomId, 
      user: this.currentUser.displayName || this.currentUser.phoneNumber,
      isHost: this.isHost,
      fromInvitation: this.fromInvitation
    });

    try {
      await this.initializeVideoCall();
      this.initializeChat();
      this.setupEventListeners();
      
      console.log('✅ VideoCallComponent initialized successfully');
      
    } catch (error) {
      console.error('❌ Error initializing video call:', error);
      this.setError('Failed to initialize video call: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  private async initializeFromRoute(): Promise<void> {
    return new Promise((resolve) => {
      // Get roomId from route params
      this.route.params.subscribe(params => {
        this.routeRoomId = params['roomId'];
      });

      // Get query params
      this.route.queryParams.subscribe(queryParams => {
        this.isHost = queryParams['host'] === 'true';
        this.fromInvitation = queryParams['fromInvitation'] === 'true';
      });

      // Get current user from auth service
      this.routeCurrentUser = this.authService.currentUser;
      
      if (!this.routeCurrentUser) {
        // Wait for auth state if not immediately available
        const authSub = this.authService.authState$.subscribe(user => {
          if (user) {
            this.routeCurrentUser = user;
            authSub.unsubscribe(); // Unsubscribe after getting user
            resolve();
          }
        });
        
        // Add timeout to avoid waiting forever
        setTimeout(() => {
          if (!this.routeCurrentUser) {
            console.warn('⚠️ No authenticated user found after timeout');
            resolve();
          }
        }, 2000);
      } else {
        resolve();
      }
    });
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.videoCallService.endCall();
    if (this.roomId) {
      this.chatService.leaveRoom(this.roomId);
    }
  }

  private async initializeVideoCall() {
    if (!this.roomId || !this.currentUser) return;

    // Initialize WebRTC service with route-specific logic
    if (this.fromInvitation) {
      await this.videoCallService.joinCallFromInvitation(this.roomId, this.currentUser);
    } else {
      await this.videoCallService.initializeCall(this.roomId, this.currentUser);
    }
    
    // Set up video elements
    const localStream = this.videoCallService.getLocalStream();
    if (localStream && this.localVideo?.nativeElement) {
      this.localVideo.nativeElement.srcObject = localStream;
    }
    
    // Listen for remote stream
    const remoteStreamSub = this.videoCallService.remoteStream$.subscribe(stream => {
      if (stream && stream.getTracks().length > 0 && this.remoteVideo?.nativeElement) {
        this.remoteVideo.nativeElement.srcObject = stream;
        this.hasRemoteVideo = true;
        console.log('📹 Remote video stream connected');
      }
    });

    // Listen for connection status
    const statusSub = this.videoCallService.connectionStatus$.subscribe(status => {
      this.connectionStatus = status;
      console.log('🔗 Connection status:', status);
    });

    // Listen for remote user info
    const userSub = this.videoCallService.remoteUser$.subscribe(user => {
      if (user) {
        this.remoteUserName = user.displayName || 'Remote User';
        console.log('👤 Remote user connected:', this.remoteUserName);
      }
    });

    this.subscriptions.push(remoteStreamSub, statusSub, userSub);
  }

  private initializeChat() {
    if (!this.roomId || !this.currentUser) return;

    // Join chat room
    this.chatService.joinRoom(this.roomId, this.currentUser);
    
    // Listen for messages
    const messagesSub = this.chatService.getMessages(this.roomId).subscribe(messages => {
      const previousCount = this.messages.length;
      this.messages = messages;
      
      // Count unread messages if chat is closed
      if (!this.showChat && messages.length > previousCount) {
        this.unreadMessages += messages.length - previousCount;
      }
      
      // Auto-scroll to bottom
      setTimeout(() => this.scrollToBottom(), 100);
    });
    
    this.subscriptions.push(messagesSub);
  }

  private setupEventListeners() {
    // Handle browser close/refresh
    const handleBeforeUnload = () => {
      this.videoCallService.endCall();
      if (this.roomId) {
        this.chatService.leaveRoom(this.roomId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Clean up listener on destroy
    this.subscriptions.push({
      unsubscribe: () => window.removeEventListener('beforeunload', handleBeforeUnload)
    } as Subscription);
  }

  // Video controls
  toggleVideo() {
    this.isVideoOn = this.videoCallService.toggleVideo();
    console.log('📹 Video toggled:', this.isVideoOn);
  }

  toggleAudio() {
    this.isAudioOn = this.videoCallService.toggleAudio();
    console.log('🎤 Audio toggled:', this.isAudioOn);
  }

  async switchCamera() {
    try {
      await this.videoCallService.switchCamera();
      this.setSuccess('Camera switched');
      console.log('📱 Camera switched');
    } catch (error) {
      console.error('❌ Error switching camera:', error);
      this.setError('Failed to switch camera');
    }
  }

  async toggleScreenShare() {
    try {
      if (this.isScreenSharing) {
        await this.videoCallService.stopScreenShare();
        this.isScreenSharing = false;
        this.setSuccess('Screen sharing stopped');
        console.log('🖥️ Screen sharing stopped');
      } else {
        await this.videoCallService.startScreenShare();
        this.isScreenSharing = true;
        this.setSuccess('Screen sharing started');
        console.log('🖥️ Screen sharing started');
      }
    } catch (error) {
      console.error('❌ Error toggling screen share:', error);
      this.setError('Failed to toggle screen sharing');
    }
  }

  endCall() {
    console.log('📞 Ending call...');
    this.videoCallService.endCall();
    if (this.roomId) {
      this.chatService.leaveRoom(this.roomId);
    }
    
    // Navigate back to lobby or emit event
    if (this.leaveRoom.observers.length > 0) {
      this.leaveRoom.emit();
    } else {
      this.router.navigate(['/lobby']);
    }
  }

  // Chat functions
  toggleChat() {
    this.showChat = !this.showChat;
    if (this.showChat) {
      this.unreadMessages = 0;
      setTimeout(() => this.scrollToBottom(), 100);
    }
    console.log('💬 Chat toggled:', this.showChat);
  }

  sendMessage() {
    if (!this.newMessage.trim() || !this.roomId || !this.currentUser) return;
    
    console.log('💬 Sending message:', this.newMessage.trim());
    this.chatService.sendMessage(this.roomId, this.newMessage.trim(), this.currentUser);
    this.newMessage = '';
  }

  private scrollToBottom() {
    if (this.chatMessages?.nativeElement) {
      const element = this.chatMessages.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  // UI helpers
  async copyRoomId() {
    if (!this.roomId) return;

    try {
      await navigator.clipboard.writeText(this.roomId);
      this.setSuccess('Room ID copied to clipboard');
      console.log('📋 Room ID copied:', this.roomId);
    } catch (error) {
      console.error('❌ Error copying room ID:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = this.roomId;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.setSuccess('Room ID copied to clipboard');
    }
  }

  getStatusClass(): string {
    if (this.connectionStatus.includes('Connected')) return 'connected';
    if (this.connectionStatus.includes('Connecting')) return 'connecting';
    return 'failed';
  }

  getInitials(name: string): string {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';
  }

  formatTime(timestamp: any): string {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Dragging functionality for local video
  startDragging(event: PointerEvent) {
    this.isDragging = true;
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    this.dragOffset.x = event.clientX - rect.left;
    this.dragOffset.y = event.clientY - rect.top;
    
    document.addEventListener('pointermove', this.onDrag.bind(this));
    document.addEventListener('pointerup', this.stopDragging.bind(this));
    event.preventDefault();
  }

  private onDrag(event: PointerEvent) {
    if (!this.isDragging) return;
    
    const container = document.querySelector('.video-area') as HTMLElement;
    if (!container) return;

    const maxX = container.clientWidth - 220; // 200px width + 20px margin
    const maxY = container.clientHeight - 170; // 150px height + 20px margin
    
    this.localVideoPosition.x = Math.max(20, Math.min(maxX, event.clientX - this.dragOffset.x));
    this.localVideoPosition.y = Math.max(20, Math.min(maxY, event.clientY - this.dragOffset.y));
  }

  private stopDragging() {
    this.isDragging = false;
    document.removeEventListener('pointermove', this.onDrag.bind(this));
    document.removeEventListener('pointerup', this.stopDragging.bind(this));
  }

  // Error handling
  private setError(message: string) {
    this.errorMessage = message;
    this.successMessage = '';
    setTimeout(() => this.clearError(), 5000);
  }

  private setSuccess(message: string) {
    this.successMessage = message;
    this.errorMessage = '';
    setTimeout(() => this.clearSuccess(), 3000);
  }

  clearError() {
    this.errorMessage = '';
  }

  clearSuccess() {
    this.successMessage = '';
  }
}