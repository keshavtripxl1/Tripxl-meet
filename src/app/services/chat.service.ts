// src/app/services/chat.service.ts
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Firestore,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  QuerySnapshot,
  DocumentData
} from '@angular/fire/firestore';
import { User } from './auth.service';

export interface ChatMessage {
  id?: string;
  content: string;
  senderId: string;
  senderName: string;
  roomId: string;
  timestamp: any;
  type: 'text' | 'system';
}

export interface ChatRoom {
  id: string;
  participants: string[];
  createdAt: any;
  lastMessage?: string;
  lastMessageTime?: any;
}

// Add proper typing for typing indicator data
interface TypingIndicatorData {
  userId: string;
  userName: string;
  timestamp: any; // Firebase Timestamp
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {
  constructor(private firestore: Firestore) {}

  async joinRoom(roomId: string, user: User): Promise<void> {
    try {
      const roomRef = doc(this.firestore, 'chatRooms', roomId);
      const roomDoc = await getDoc(roomRef);

      if (roomDoc.exists()) {
        const roomData = roomDoc.data() as ChatRoom;
        const participants = roomData.participants || [];
        
        if (!participants.includes(user.uid)) {
          participants.push(user.uid);
          await updateDoc(roomRef, { participants });
          
          // Send system message about user joining
          await this.sendSystemMessage(roomId, `${user.displayName || 'User'} joined the chat`);
        }
      } else {
        // Create new chat room
        const roomData: ChatRoom = {
          id: roomId,
          participants: [user.uid],
          createdAt: serverTimestamp()
        };
        
        await setDoc(roomRef, roomData);
        await this.sendSystemMessage(roomId, `${user.displayName || 'User'} created the chat room`);
      }
      
      console.log('✅ Joined chat room:', roomId);
    } catch (error) {
      console.error('❌ Error joining chat room:', error);
      throw error;
    }
  }

  async leaveRoom(roomId: string, user?: User): Promise<void> {
    try {
      if (user) {
        // Remove user from participants
        const roomRef = doc(this.firestore, 'chatRooms', roomId);
        const roomDoc = await getDoc(roomRef);
        
        if (roomDoc.exists()) {
          const roomData = roomDoc.data() as ChatRoom;
          const participants = roomData.participants || [];
          const updatedParticipants = participants.filter(uid => uid !== user.uid);
          
          await updateDoc(roomRef, { participants: updatedParticipants });
          
          // Send system message about user leaving
          await this.sendSystemMessage(roomId, `${user.displayName || 'User'} left the chat`);
        }
      }
      
      console.log('👋 Left chat room:', roomId);
    } catch (error) {
      console.error('❌ Error leaving chat room:', error);
    }
  }

  async sendMessage(roomId: string, content: string, user: User): Promise<void> {
    try {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      
      const message: Omit<ChatMessage, 'id'> = {
        content: content.trim(),
        senderId: user.uid,
        senderName: user.displayName || user.phoneNumber.slice(-4) || 'User',
        roomId,
        timestamp: serverTimestamp(),
        type: 'text'
      };

      await addDoc(messagesRef, message);
      
      // Update room's last message
      const roomRef = doc(this.firestore, 'chatRooms', roomId);
      await updateDoc(roomRef, {
        lastMessage: content.trim(),
        lastMessageTime: serverTimestamp()
      });
      
      console.log('📤 Message sent:', content);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      throw error;
    }
  }

  private async sendSystemMessage(roomId: string, content: string): Promise<void> {
    try {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      
      const message: Omit<ChatMessage, 'id'> = {
        content,
        senderId: 'system',
        senderName: 'System',
        roomId,
        timestamp: serverTimestamp(),
        type: 'system'
      };

      await addDoc(messagesRef, message);
    } catch (error) {
      console.error('❌ Error sending system message:', error);
    }
  }

  getMessages(roomId: string): Observable<ChatMessage[]> {
    return new Observable(observer => {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      const q = query(messagesRef, orderBy('timestamp', 'asc'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const messages: ChatMessage[] = [];
        
        snapshot.forEach(doc => {
          const messageData = doc.data() as Omit<ChatMessage, 'id'>;
          messages.push({
            id: doc.id,
            ...messageData
          });
        });
        
        observer.next(messages);
      }, (error) => {
        console.error('❌ Error listening to messages:', error);
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  async deleteMessage(roomId: string, messageId: string): Promise<void> {
    try {
      const messageRef = doc(this.firestore, 'chatRooms', roomId, 'messages', messageId);
      await updateDoc(messageRef, {
        content: '[Message deleted]',
        type: 'system'
      });
      
      console.log('🗑️ Message deleted:', messageId);
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      throw error;
    }
  }

  async getRoomInfo(roomId: string): Promise<ChatRoom | null> {
    try {
      const roomRef = doc(this.firestore, 'chatRooms', roomId);
      const roomDoc = await getDoc(roomRef);
      
      if (roomDoc.exists()) {
        return roomDoc.data() as ChatRoom;
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting room info:', error);
      return null;
    }
  }

  // Listen for typing indicators (optional feature)
  async sendTypingIndicator(roomId: string, user: User, isTyping: boolean): Promise<void> {
    try {
      const typingRef = doc(this.firestore, 'chatRooms', roomId, 'typing', user.uid);
      
      if (isTyping) {
        const typingData: TypingIndicatorData = {
          userId: user.uid,
          userName: user.displayName || 'User',
          timestamp: serverTimestamp()
        };
        
        await setDoc(typingRef, typingData);
      } else {
        // Remove typing indicator by deleting the document
        try {
          await deleteDoc(typingRef);
        } catch (error) {
          // Document might not exist, which is fine
          console.log('Typing indicator document not found (already removed)');
        }
      }
    } catch (error) {
      console.error('❌ Error sending typing indicator:', error);
    }
  }

  getTypingUsers(roomId: string, currentUserId: string): Observable<string[]> {
    return new Observable(observer => {
      const typingRef = collection(this.firestore, 'chatRooms', roomId, 'typing');
      
      const unsubscribe = onSnapshot(typingRef, (snapshot) => {
        const typingUsers: string[] = [];
        const now = Date.now();
        
        snapshot.forEach(doc => {
          const typingData = doc.data() as TypingIndicatorData;
          const userId = typingData?.userId;
          const userName = typingData?.userName;
          const timestamp = typingData?.timestamp;
          
          // Convert Firebase timestamp to milliseconds if it exists
          let timestampMs: number | null = null;
          if (timestamp) {
            if (typeof timestamp.toMillis === 'function') {
              timestampMs = timestamp.toMillis();
            } else if (typeof timestamp === 'number') {
              timestampMs = timestamp;
            }
          }
          
          // Consider user typing if timestamp is within last 3 seconds
          if (userId && 
              userId !== currentUserId && 
              userName && 
              timestampMs && 
              (now - timestampMs) < 3000) {
            typingUsers.push(userName);
          }
        });
        
        observer.next(typingUsers);
      }, (error) => {
        console.error('❌ Error listening to typing indicators:', error);
        observer.error(error);
      });

      return () => unsubscribe();
    });
  }

  // Additional helper methods
  async clearOldMessages(roomId: string, olderThanDays: number = 30): Promise<void> {
    try {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      // In a real implementation, you'd want to use a batch delete with server-side functions
      console.log(`🧹 Old message cleanup would delete messages older than ${cutoffDate}`);
      
    } catch (error) {
      console.error('❌ Error clearing old messages:', error);
    }
  }

  // Fixed getMessageCount method
  async getMessageCount(roomId: string): Promise<number> {
    try {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      const snapshot: QuerySnapshot<DocumentData> = await getDocs(messagesRef);
      return snapshot.size;
    } catch (error) {
      console.error('❌ Error getting message count:', error);
      return 0;
    }
  }

  // Additional utility methods
  async getRoomParticipants(roomId: string): Promise<string[]> {
    try {
      const roomInfo = await this.getRoomInfo(roomId);
      return roomInfo?.participants || [];
    } catch (error) {
      console.error('❌ Error getting room participants:', error);
      return [];
    }
  }

  async isUserInRoom(roomId: string, userId: string): Promise<boolean> {
    try {
      const participants = await this.getRoomParticipants(roomId);
      return participants.includes(userId);
    } catch (error) {
      console.error('❌ Error checking if user is in room:', error);
      return false;
    }
  }

  // Get recent messages (last N messages)
  async getRecentMessages(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const messagesRef = collection(this.firestore, 'chatRooms', roomId, 'messages');
      const q = query(messagesRef, orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);
      
      const messages: ChatMessage[] = [];
      snapshot.forEach(doc => {
        const messageData = doc.data() as Omit<ChatMessage, 'id'>;
        messages.push({
          id: doc.id,
          ...messageData
        });
      });
      
      // Return in ascending order (oldest first)
      return messages.reverse().slice(-limit);
    } catch (error) {
      console.error('❌ Error getting recent messages:', error);
      return [];
    }
  }
}