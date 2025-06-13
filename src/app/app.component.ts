// app.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { AuthService, User } from './services/auth.service';
import { AuthComponent } from './components/auth/auth.component';
import { VideoCallComponent } from './components/video-call/video-call.component';
import { LobbyComponent } from './components/lobby/lobby.component';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { VideoCallService } from './services/video-call.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AuthComponent, VideoCallComponent, LobbyComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  isLoading = true;
  isAuthenticated = false;
  currentUser: User | null = null;
  currentView: 'lobby' | 'call' = 'lobby';
  currentRoomId: string | null = null;
  
  private subscriptions: Subscription[] = [];

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private videoCallService: VideoCallService
  ) {}

  async ngOnInit() {
    console.log('🚀 App initializing...');
    
    try {
      // Check if user is already authenticated
      const user = await this.authService.getCurrentUser();
      if (user) {
        console.log('✅ User found:', user);
        this.currentUser = user;
        this.isAuthenticated = true;
        // Set user as online
        this.videoCallService.setCurrentUser(user);
        await this.authService.setUserOnlineStatus(true);
      } else {
        console.log('❌ No authenticated user found');
      }
    } catch (error) {
      console.error('❌ Error checking auth state:', error);
    } finally {
      this.isLoading = false;
      console.log('✅ App initialization complete');
    }

    // Listen for auth state changes
    const authSub = this.authService.authState$.subscribe(user => {
      console.log('🔄 Auth state changed:', user);
      this.currentUser = user;
      this.isAuthenticated = !!user;
      
      if (user) {
        this.videoCallService.setCurrentUser(user);
      }
      // If user logs out, return to lobby
      if (!user) {
        this.currentView = 'lobby';
        this.currentRoomId = null;
      } else {
        // User logged in, check current route
        this.handleCurrentRoute();
      }
    });

    const videoNavSub = this.videoCallService.navigation$.subscribe(navEvent => {
      if (navEvent && navEvent.action === 'navigate' && navEvent.roomId) {
        console.log('🎥 Video service requesting navigation to room:', navEvent.roomId);
        this.router.navigate(['call', navEvent.roomId], { 
          queryParams: { host: navEvent.isHost ? 'true' : 'false' } 
        });
        // Clear the navigation event
        this.videoCallService.clearNavigationEvent();
      } else if (navEvent && navEvent.action === 'declined') {
        console.log('❌ Call invitation was declined');
        // You could show a message here
      }
    });

    // Listen for route changes - FIXED TYPE CASTING
    const routerSub = this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        console.log('🔄 Route changed to:', event.url);
        this.handleRouteChange(event.url);
      }
    });

    this.subscriptions.push(authSub, routerSub, videoNavSub);

    // Handle initial route
    this.handleCurrentRoute();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private handleCurrentRoute() {
    this.handleRouteChange(this.router.url);
  }

  private handleRouteChange(url: string) {
    console.log('🎯 Handling route:', url);

    if (url.startsWith('/call/')) {
      // Extract room ID from URL like /call/abc123?host=true
      const urlParts = url.split('/call/')[1];
      const roomId = urlParts ? urlParts.split('?')[0] : '';
      
      if (roomId && this.isAuthenticated && this.currentUser) {
        console.log('🎥 Switching to call view with room:', roomId);
        this.currentRoomId = roomId;
        this.currentView = 'call';
      } else {
        console.log('❌ Cannot enter call - missing requirements');
        console.log('  - Room ID:', roomId);
        console.log('  - Authenticated:', this.isAuthenticated);
        console.log('  - User:', !!this.currentUser);
        
        // Redirect to lobby if can't enter call
        this.router.navigate(['/lobby']);
      }
    } else {
      // Any other route - show lobby
      console.log('🏠 Switching to lobby view');
      this.currentView = 'lobby';
      this.currentRoomId = null;
    }
  }

  onAuthSuccess() {
    console.log('✅ Authentication successful');
    const user = this.authService.currentUser;
    if (user) {
      this.isAuthenticated = true;
      this.currentUser = user;
      console.log('✅ Current user set:', user);
      
      // Navigate to lobby after successful auth
      this.router.navigate(['/lobby']);
    } else {
      console.error('❌ Auth success but no current user');
    }
  }

  onJoinRoom(roomId: string) {
    if (!this.currentUser) {
      console.error('❌ Cannot join room: No current user');
      return;
    }
    
    console.log('🚪 Joining room via navigation:', roomId);
    // Use router navigation instead of direct state change
    this.router.navigate(['call', roomId], { 
      queryParams: { host: 'false' } 
    });
  }

  onCreateRoom() {
    if (!this.currentUser) {
      console.error('❌ Cannot create room: No current user');
      return;
    }
    
    const roomId = this.generateRoomId();
    console.log('🏠 Creating room via navigation:', roomId);
    // Use router navigation instead of direct state change
    this.router.navigate(['call', roomId], { 
      queryParams: { host: 'true' } 
    });
  }

  onLeaveRoom() {
    console.log('👋 Leaving room');
    // Use router navigation to go back to lobby
    this.router.navigate(['/lobby']);
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15);
  }
}