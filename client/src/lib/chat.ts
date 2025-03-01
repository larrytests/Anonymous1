import { auth } from "./firebase";
import { io, Socket } from "socket.io-client";

interface ChatMessage {
  type: 'message' | 'connection_status' | 'user_connected' | 'typing' | 'voice_call' | 'ice-candidate';
  content?: string;
  senderId?: string;
  receiverId?: string;
  timestamp?: string;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected';
  userId?: string;
  isTyping?: boolean;
  callData?: {
    type: 'request' | 'accepted' | 'rejected' | 'ended' | 'busy';
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
  };
}

export class ChatService {
  private socket: Socket | null = null;
  private messageCallbacks: Set<(message: ChatMessage) => void> = new Set();
  private connectionState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private messageSet = new Set<string>();
  private typingTimeoutId: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeConnection();
  }

  private generateMessageId(message: ChatMessage): string {
    return `${message.type}-${message.senderId}-${message.receiverId}-${message.timestamp || ''}-${JSON.stringify(message.callData || '')}`;
  }

  private notifyConnectionStatus() {
    const statusMessage: ChatMessage = {
      type: 'connection_status',
      connectionStatus: this.connectionState,
      timestamp: new Date().toISOString(),
    };
    this.messageCallbacks.forEach(callback => callback(statusMessage));
  }

  private async initializeConnection(): Promise<void> {
    if (!auth.currentUser) {
      console.log("No authenticated user");
      return;
    }

    if (this.socket?.connected) {
      console.log("Already connected");
      return;
    }

    this.connectionState = 'connecting';
    this.notifyConnectionStatus();

    try {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }

      this.socket = io(window.location.origin, {
        transports: ['websocket'],
        auth: {
          token: await auth.currentUser.getIdToken(),
          userId: auth.currentUser.uid,
        },
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        timeout: 10000,
      });

      this.socket.on("connect", () => {
        console.log("Socket.IO connected");
        this.connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.notifyConnectionStatus();
        this.messageSet.clear();

        if (auth.currentUser) {
          this.socket?.emit("user_connected", {
            type: 'user_connected',
            senderId: auth.currentUser.uid,
            timestamp: new Date().toISOString(),
          });
        }
      });

      this.socket.on("disconnect", () => {
        console.log("Socket.IO disconnected");
        this.connectionState = 'disconnected';
        this.notifyConnectionStatus();
      });

      this.socket.on("connect_error", (error) => {
        console.error("Socket.IO connection error:", error);
        this.connectionState = 'disconnected';
        this.notifyConnectionStatus();
      });

      const handleMessage = (message: ChatMessage) => {
        // Skip messages from self (except typing indicators)
        if (message.senderId === auth.currentUser?.uid && message.type !== 'typing') {
          return;
        }

        const messageId = this.generateMessageId(message);
        if (!this.messageSet.has(messageId)) {
          this.messageSet.add(messageId);
          this.messageCallbacks.forEach(callback => callback(message));
        }
      };

      // Listen for different message types
      this.socket.on("message", handleMessage);
      this.socket.on("voice_call", handleMessage);
      this.socket.on("ice-candidate", handleMessage);

      // Special handling for typing indicators
      this.socket.on("typing", (message: ChatMessage) => {
        if (message.receiverId === auth.currentUser?.uid) {
          this.messageCallbacks.forEach(callback => callback(message));
        }
      });

    } catch (error) {
      console.error("Error in initializeConnection:", error);
      this.connectionState = 'disconnected';
      this.notifyConnectionStatus();
      throw error;
    }
  }

  onMessage(callback: (message: ChatMessage) => void) {
    this.messageCallbacks.add(callback);
    return () => {
      this.messageCallbacks.delete(callback);
    };
  }

  sendMessage(message: ChatMessage) {
    if (!this.socket?.connected) {
      console.warn('Socket not connected, attempting to reconnect...');
      this.initializeConnection();
      return;
    }

    try {
      const messageId = this.generateMessageId(message);
      if (!this.messageSet.has(messageId) || message.type === 'typing') {
        if (message.type !== 'typing') {
          this.messageSet.add(messageId);
        }
        this.socket.emit(message.type, message);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      if (this.connectionState !== 'connected') {
        this.initializeConnection();
      }
    }
  }

  sendTypingIndicator(receiverId: string, isTyping: boolean) {
    if (this.typingTimeoutId) {
      clearTimeout(this.typingTimeoutId);
      this.typingTimeoutId = null;
    }

    this.sendMessage({
      type: 'typing',
      senderId: auth.currentUser?.uid,
      receiverId,
      isTyping,
      timestamp: new Date().toISOString(),
    });

    if (isTyping) {
      // Auto-clear typing indicator after 3 seconds of no updates
      this.typingTimeoutId = setTimeout(() => {
        this.sendTypingIndicator(receiverId, false);
      }, 3000);
    }
  }

  // New method to get the last offer (used in accepting calls)
  async getLastOffer(senderId: string): Promise<RTCSessionDescriptionInit | null> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve(null);
        return;
      }

      // Listen for the latest voice_call offer from the sender
      const handleOffer = (message: ChatMessage) => {
        if (message.type === 'voice_call' && message.senderId === senderId && message.callData?.offer) {
          this.socket?.off('voice_call', handleOffer);
          resolve(message.callData.offer);
        }
      };

      this.socket.on('voice_call', handleOffer);

      // Timeout after 5 seconds if no offer is received
      setTimeout(() => {
        this.socket?.off('voice_call', handleOffer);
        resolve(null);
      }, 5000);
    });
  }

  close() {
    if (this.typingTimeoutId) {
      clearTimeout(this.typingTimeoutId);
      this.typingTimeoutId = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.messageCallbacks.clear();
    this.messageSet.clear();
    this.connectionState = 'disconnected';
    this.notifyConnectionStatus();
  }
}