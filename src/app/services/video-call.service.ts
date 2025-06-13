// src/app/services/video-call.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { 
  Firestore, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  addDoc, 
  query, 
  orderBy,
  serverTimestamp,
  deleteDoc
} from '@angular/fire/firestore';
import { User } from './auth.service';
import { InvitationService } from './invitation.service';

// Fixed interfaces with proper typing
interface CallOffer {
  sdp: string | undefined;
  type: RTCSdpType;
}

interface CallAnswer {
  sdp: string | undefined;
  type: RTCSdpType;
}

interface IceCandidate {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
}

interface CallData {
  offer?: CallOffer;
  answer?: CallAnswer;
  createdBy: string;
  createdAt: any;
  participants: string[];
  status: 'waiting' | 'active' | 'ended';
  endedAt?: any;
}

@Injectable({
  providedIn: 'root'
})
export class VideoCallService {
  private peerConnection!: RTCPeerConnection;
  private localStream!: MediaStream;
  private remoteStreamSubject = new BehaviorSubject<MediaStream | null>(null);
  private connectionStatusSubject = new BehaviorSubject<string>('Disconnected');
  private remoteUserSubject = new BehaviorSubject<User | null>(null);
  
  public remoteStream$ = this.remoteStreamSubject.asObservable();
  public connectionStatus$ = this.connectionStatusSubject.asObservable();
  public remoteUser$ = this.remoteUserSubject.asObservable();

  private navigationSubject = new BehaviorSubject<{action: string, roomId?: string, isHost?: boolean} | null>(null);
  public navigation$ = this.navigationSubject.asObservable();


  private currentRoomId: string | null = null;
  private currentUser: User | null = null;
  private isHost = false;
  private unsubscribeFunctions: (() => void)[] = [];
  private remoteDescriptionSet = false;
  private pendingCandidates: RTCIceCandidate[] = [];

  // Enhanced ICE servers for better connectivity
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    
    // TURN servers for NAT traversal
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:numb.viagenie.ca',
      username: 'webrtc@live.com',
      credential: 'muazkh'
    }
  ];

  constructor(
    private firestore: Firestore,
    private invitationService: InvitationService
  ) {}

  async initializeCall(roomId: string, user: User): Promise<void> {
    try {
      this.currentRoomId = roomId;
      this.currentUser = user;
      
      console.log('🚀 Initializing call for room:', roomId);
      this.connectionStatusSubject.next('Initializing...');

      // Setup local media
      await this.setupLocalMedia();
      
      // Check if room exists
      const roomExists = await this.checkRoomExists(roomId);
      this.isHost = !roomExists;

      // Setup peer connection
      await this.setupPeerConnection();

      if (this.isHost) {
        console.log('🏠 Creating new room...');
        await this.createRoom();
        // Host creates offer after a brief delay to ensure room is set up
        setTimeout(() => {
          this.createOffer();
        }, 1000);
      } else {
        console.log('🚪 Joining existing room...');
        await this.joinRoom();
      }

      // Listen for room changes
      this.listenForRoomChanges();
      
      this.connectionStatusSubject.next('Connected to room');
      console.log('✅ Call initialization complete');

    } catch (error) {
      console.error('❌ Error initializing call:', error);
      this.connectionStatusSubject.next('Failed to connect');
      throw error;
    }
  }

  private async setupLocalMedia(): Promise<void> {
    try {
      console.log('📹 Setting up local media...');
      
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Local media setup complete');
      
    } catch (error) {
      console.error('❌ Error accessing media devices:', error);
      throw new Error('Failed to access camera/microphone. Please check permissions.');
    }
  }

  private async setupPeerConnection(): Promise<void> {
    const config: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 20,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    this.peerConnection = new RTCPeerConnection(config);

    // Add local stream tracks
    this.localStream.getTracks().forEach(track => {
      console.log('🎵 Adding local track:', track.kind);
      this.peerConnection.addTrack(track, this.localStream);
    });

    // Handle remote stream
    this.peerConnection.ontrack = (event) => {
      console.log('📹 Received remote track:', event.track.kind);
      const remoteStream = event.streams[0];
      this.remoteStreamSubject.next(remoteStream);
      this.connectionStatusSubject.next('Connected - Video active');
    };

    // Handle ICE candidates
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && this.currentRoomId) {
        console.log('🧊 Sending ICE candidate');
        await this.addIceCandidate(event.candidate);
      } else if (!event.candidate) {
        console.log('🧊 ICE gathering complete');
      }
    };

    // Monitor connection state
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('🔗 Connection state:', state);
      
      switch (state) {
        case 'connecting':
          this.connectionStatusSubject.next('Connecting...');
          break;
        case 'connected':
          this.connectionStatusSubject.next('Connected');
          break;
        case 'disconnected':
          this.connectionStatusSubject.next('Reconnecting...');
          setTimeout(() => {
            if (this.peerConnection.connectionState === 'disconnected') {
              console.log('🔄 Attempting ICE restart...');
              this.peerConnection.restartIce();
            }
          }, 3000);
          break;
        case 'failed':
          this.connectionStatusSubject.next('Connection failed');
          setTimeout(() => {
            console.log('🔄 Attempting connection restart...');
            this.peerConnection.restartIce();
          }, 1000);
          break;
        case 'closed':
          this.connectionStatusSubject.next('Call ended');
          break;
      }
    };

    // Monitor ICE connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log('🧊 ICE connection state:', iceState);
      
      switch (iceState) {
        case 'checking':
          this.connectionStatusSubject.next('Establishing connection...');
          break;
        case 'connected':
        case 'completed':
          this.connectionStatusSubject.next('Connected');
          break;
        case 'failed':
          console.log('🔄 ICE connection failed, restarting...');
          this.peerConnection.restartIce();
          break;
      }
    };

    // Monitor signaling state
    this.peerConnection.onsignalingstatechange = () => {
      console.log('📡 Signaling state:', this.peerConnection.signalingState);
    };
  }

  private async checkRoomExists(roomId: string): Promise<boolean> {
    try {
      const roomRef = doc(this.firestore, 'calls', roomId);
      const roomDoc = await getDoc(roomRef);
      return roomDoc.exists();
    } catch (error) {
      console.error('Error checking room:', error);
      return false;
    }
  }

  private async createRoom(): Promise<void> {
    try {
      const roomData: CallData = {
        createdBy: this.currentUser!.uid,
        createdAt: serverTimestamp(),
        participants: [this.currentUser!.uid],
        status: 'waiting'
      };

      const roomRef = doc(this.firestore, 'calls', this.currentRoomId!);
      await setDoc(roomRef, roomData);

      console.log('✅ Room created successfully');
    } catch (error) {
      console.error('❌ Error creating room:', error);
      throw error;
    }
  }

  private async joinRoom(): Promise<void> {
    try {
      // Add current user to participants
      const roomRef = doc(this.firestore, 'calls', this.currentRoomId!);
      const roomDoc = await getDoc(roomRef);
      
      if (roomDoc.exists()) {
        const roomData = roomDoc.data() as CallData;
        const participants = roomData.participants || [];
        
        if (!participants.includes(this.currentUser!.uid)) {
          participants.push(this.currentUser!.uid);
          await updateDoc(roomRef, { 
            participants,
            status: 'active'
          });
        }

        // If there's an offer, handle it
        if (roomData.offer) {
          await this.handleOffer(roomData.offer);
        }
      }

      console.log('✅ Joined room successfully');
    } catch (error) {
      console.error('❌ Error joining room:', error);
      throw error;
    }
  }

  private listenForRoomChanges(): void {
    const roomRef = doc(this.firestore, 'calls', this.currentRoomId!);
    
    const unsubscribe = onSnapshot(roomRef, async (doc) => {
      if (doc.exists()) {
        const roomData = doc.data() as CallData;
        
        // Handle offer (for joiners)
        if (roomData.offer && !this.isHost && 
            this.peerConnection.signalingState === 'stable' && 
            !this.remoteDescriptionSet) {
          await this.handleOffer(roomData.offer);
        }
        
        // Handle answer (for hosts)
        if (roomData.answer && this.isHost && 
            this.peerConnection.signalingState === 'have-local-offer' &&
            !this.remoteDescriptionSet) {
          await this.handleAnswer(roomData.answer);
        }
      }
    });

    this.unsubscribeFunctions.push(unsubscribe);

    // Listen for ICE candidates
    this.listenForIceCandidates();
  }

  private async handleOffer(offer: CallOffer): Promise<void> {
    try {
      console.log('📞 Handling offer...');
      
      // Create RTCSessionDescription with proper typing
      const sessionDescription: RTCSessionDescriptionInit = {
        sdp: offer.sdp,
        type: offer.type
      };
      
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sessionDescription));
      this.remoteDescriptionSet = true;
      
      // Process any pending ICE candidates
      await this.processPendingIceCandidates();
      
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      // Save answer to Firestore
      const roomRef = doc(this.firestore, 'calls', this.currentRoomId!);
      await updateDoc(roomRef, {
        answer: {
          sdp: answer.sdp,
          type: answer.type
        }
      });
      
      console.log('✅ Answer sent');
    } catch (error) {
      console.error('❌ Error handling offer:', error);
    }
  }

  private async handleAnswer(answer: CallAnswer): Promise<void> {
    try {
      console.log('📞 Handling answer...');
      
      // Create RTCSessionDescription with proper typing
      const sessionDescription: RTCSessionDescriptionInit = {
        sdp: answer.sdp,
        type: answer.type
      };
      
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sessionDescription));
      this.remoteDescriptionSet = true;
      
      // Process any pending ICE candidates
      await this.processPendingIceCandidates();
      
      console.log('✅ Answer processed');
    } catch (error) {
      console.error('❌ Error handling answer:', error);
    }
  }

  private listenForIceCandidates(): void {
    const iceCandidatesRef = collection(this.firestore, 'calls', this.currentRoomId!, 'iceCandidates');
    const q = query(iceCandidatesRef, orderBy('timestamp'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const candidateData = change.doc.data() as IceCandidate & { senderId: string };
          
          // Only process candidates from other users
          if (candidateData.senderId !== this.currentUser!.uid) {
            try {
              const candidate = new RTCIceCandidate({
                candidate: candidateData.candidate,
                sdpMLineIndex: candidateData.sdpMLineIndex,
                sdpMid: candidateData.sdpMid
              });
              
              if (this.remoteDescriptionSet) {
                await this.peerConnection.addIceCandidate(candidate);
                console.log('✅ ICE candidate added');
              } else {
                this.pendingCandidates.push(candidate);
                console.log('📦 ICE candidate queued (waiting for remote description)');
              }
            } catch (error) {
              console.error('❌ Error adding ICE candidate:', error);
            }
          }
        }
      });
    });

    this.unsubscribeFunctions.push(unsubscribe);
  }

  private async processPendingIceCandidates(): Promise<void> {
    console.log(`🧊 Processing ${this.pendingCandidates.length} pending ICE candidates`);
    
    for (const candidate of this.pendingCandidates) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('✅ Processed pending ICE candidate');
      } catch (error) {
        console.error('❌ Error processing pending ICE candidate:', error);
      }
    }
    
    this.pendingCandidates = [];
  }

  private async addIceCandidate(candidate: RTCIceCandidate): Promise<void> {
    try {
      const iceCandidatesRef = collection(this.firestore, 'calls', this.currentRoomId!, 'iceCandidates');
      
      await addDoc(iceCandidatesRef, {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
        senderId: this.currentUser!.uid,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('❌ Error saving ICE candidate:', error);
    }
  }

  async createOffer(): Promise<void> {
    try {
      console.log('📤 Creating offer...');
      
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await this.peerConnection.setLocalDescription(offer);
      
      // Save offer to Firestore
      const roomRef = doc(this.firestore, 'calls', this.currentRoomId!);
      await updateDoc(roomRef, {
        offer: {
          sdp: offer.sdp,
          type: offer.type
        }
      });
      
      console.log('✅ Offer created and sent');
    } catch (error) {
      console.error('❌ Error creating offer:', error);
      throw error;
    }
  }

  // Media controls
  toggleVideo(): boolean {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        console.log('📹 Video toggled:', videoTrack.enabled);
        return videoTrack.enabled;
      }
    }
    return false;
  }

  toggleAudio(): boolean {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        console.log('🎤 Audio toggled:', audioTrack.enabled);
        return audioTrack.enabled;
      }
    }
    return false;
  }

  async switchCamera(): Promise<void> {
    if (!this.localStream) {
      throw new Error('No local stream available');
    }

    try {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('No video track available');
      }

      const currentConstraints = videoTrack.getSettings();
      const isFront = currentConstraints.facingMode === 'user';
      
      console.log('📱 Switching camera from:', currentConstraints.facingMode);
      
      // Stop current video track
      videoTrack.stop();
      
      // Get new stream with opposite camera
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: isFront ? 'environment' : 'user' },
        audio: false
      });
      
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      // Replace track in peer connection
      const sender = this.peerConnection.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
        console.log('✅ Video track replaced in peer connection');
      }
      
      // Replace track in local stream
      this.localStream.removeTrack(videoTrack);
      this.localStream.addTrack(newVideoTrack);
      
      console.log('✅ Camera switched successfully');
    } catch (error) {
      console.error('❌ Error switching camera:', error);
      throw new Error('Failed to switch camera. This feature may not be available on your device.');
    }
  }

  async startScreenShare(): Promise<void> {
    try {
      console.log('🖥️ Starting screen share...');
      
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      
      const videoTrack = screenStream.getVideoTracks()[0];
      
      // Replace video track in peer connection
      const sender = this.peerConnection.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      
      if (sender) {
        await sender.replaceTrack(videoTrack);
        console.log('✅ Screen share track added to peer connection');
      }
      
      // Handle screen share end
      videoTrack.onended = () => {
        this.stopScreenShare().catch(console.error);
      };
      
      console.log('✅ Screen sharing started');
    } catch (error) {
      console.error('❌ Error starting screen share:', error);
      throw new Error('Failed to start screen sharing');
    }
  }

  async stopScreenShare(): Promise<void> {
    try {
      console.log('🖥️ Stopping screen share...');
      
      // Get original camera stream
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      
      const videoTrack = cameraStream.getVideoTracks()[0];
      
      // Replace screen share track with camera track
      const sender = this.peerConnection.getSenders().find(s => 
        s.track && s.track.kind === 'video'
      );
      
      if (sender) {
        await sender.replaceTrack(videoTrack);
        console.log('✅ Camera track restored in peer connection');
      }
      
      // Update local stream
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      this.localStream.addTrack(videoTrack);
      
      console.log('✅ Screen sharing stopped');
    } catch (error) {
      console.error('❌ Error stopping screen share:', error);
      throw new Error('Failed to stop screen sharing');
    }
  }

  getLocalStream(): MediaStream {
    return this.localStream;
  }

  getRemoteStream(): MediaStream | null {
    return this.remoteStreamSubject.value;
  }

  async endCall(): Promise<void> {
    try {
      console.log('📞 Ending call...');
      
      // Clean up peer connection
      if (this.peerConnection) {
        this.peerConnection.close();
      }

      // Stop local media tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          track.stop();
          console.log('🛑 Stopped local track:', track.kind);
        });
      }

      // Clean up Firestore listeners
      this.unsubscribeFunctions.forEach(unsubscribe => {
        try {
          unsubscribe();
        } catch (error) {
          console.error('❌ Error unsubscribing:', error);
        }
      });
      this.unsubscribeFunctions = [];

      // Update room status
      if (this.currentRoomId) {
        try {
          const roomRef = doc(this.firestore, 'calls', this.currentRoomId);
          await updateDoc(roomRef, {
            status: 'ended',
            endedAt: serverTimestamp()
          });
          
          // Delete room after 1 minute (cleanup)
          setTimeout(async () => {
            try {
              await deleteDoc(roomRef);
              console.log('🗑️ Room deleted');
            } catch (error) {
              console.error('❌ Error deleting room:', error);
            }
          }, 60000);
        } catch (error) {
          console.error('❌ Error updating room status:', error);
        }
      }

      // Reset state
      this.remoteStreamSubject.next(null);
      this.connectionStatusSubject.next('Call ended');
      this.remoteUserSubject.next(null);
      this.currentRoomId = null;
      this.currentUser = null;
      this.isHost = false;
      this.remoteDescriptionSet = false;
      this.pendingCandidates = [];

      console.log('✅ Call ended successfully');
    } catch (error) {
      console.error('❌ Error ending call:', error);
    }
  }

  // Connection quality monitoring
  async getConnectionStats(): Promise<any> {
    if (!this.peerConnection) return null;

    try {
      const stats = await this.peerConnection.getStats();
      const statsReport: any = {};
      
      stats.forEach(report => {
        if (report.type === 'inbound-rtp') {
          statsReport.inbound = {
            bytesReceived: report.bytesReceived,
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost
          };
        }
        
        if (report.type === 'outbound-rtp') {
          statsReport.outbound = {
            bytesSent: report.bytesSent,
            packetsSent: report.packetsSent
          };
        }
        
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          statsReport.connection = {
            roundTripTime: report.currentRoundTripTime,
            availableOutgoingBitrate: report.availableOutgoingBitrate
          };
        }
      });
      
      return statsReport;
    } catch (error) {
      console.error('❌ Error getting connection stats:', error);
      return null;
    }
  }

  // Auto-trigger offer creation for hosts
  async startCall(): Promise<void> {
    if (this.isHost && this.peerConnection.signalingState === 'stable') {
      await this.createOffer();
    }
  }

  // Generate room ID
  generateRoomId(): string {
    return Math.random().toString(36).substring(2, 15) + 
          Math.random().toString(36).substring(2, 15);
  }

  // Invite user to call
  async inviteUserToCall(user: User): Promise<void> {
    const currentUser = this.currentUser;
    if (!currentUser) {
      throw new Error('No current user available for video call service');
    }
    const roomId = this.generateRoomId();
    
    try {
      console.log('🎥 Inviting user to call:', user);
      const invitationId = await this.invitationService.sendInvitation(user, roomId);
      
      // Listen for invitation response
      this.invitationService.listenForInvitationResponse(invitationId).subscribe(async status => {
        console.log('📞 Invitation response:', status);
        
        if (status === 'accepted') {
          //await this.initializeCall(roomId, this.currentUser!);
          this.navigationSubject.next({ action: 'navigate', roomId, isHost: true });
          console.log('🚀 Starting call as host...');
        } else if (status === 'declined') {
          console.log('❌ Invitation was declined');
          this.navigationSubject.next({ action: 'declined' });
        } else if (status === 'expired') {
          console.log('⏰ Invitation expired');
          this.navigationSubject.next({ action: 'expired' });
        }
      });
      
      console.log('✅ Invitation sent successfully');
    } catch (error) {
      console.error('❌ Error sending invitation:', error);
      throw error;
    }
  }

  // Join call from invitation (for invited user)
  async joinCallFromInvitation(roomId: string, user: User): Promise<void> {
    try {
      console.log('🚪 Joining call from invitation, room:', roomId);
      this.currentUser = user;
      this.currentRoomId = roomId;
      this.isHost = false;
      await this.initializeCall(roomId, user);
      console.log('✅ Successfully joined call from invitation');
    } catch (error) {
      console.error('❌ Error joining call from invitation:', error);
      throw error;
    }
  }

  clearNavigationEvent(): void {
    this.navigationSubject.next(null);
  }

  // Set current user (add this method)
  setCurrentUser(user: User): void {
    this.currentUser = user;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }
}