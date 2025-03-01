import {
  relievers,
  messages,
  type Reliever,
  type InsertReliever,
  type Message,
  type InsertMessage,
} from "@shared/schema";

// New Call interface for voice chat metadata
interface Call {
  id: number;
  callerId: string;
  receiverId: string;
  status: "request" | "accepted" | "rejected" | "ended" | "busy";
  timestamp: Date;
}

export interface IStorage {
  // Reliever methods
  getRelievers(): Promise<Reliever[]>;
  getReliever(id: number): Promise<Reliever | undefined>;
  createReliever(reliever: InsertReliever): Promise<Reliever>;
  updateRelieverStatus(
    id: number,
    isAvailable: boolean,
  ): Promise<Reliever | undefined>;

  // Message methods
  getMessages(senderId: string, receiverId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  markMessageAsRead(messageId: number): Promise<void>;

  // New Call methods (optional for voice chat)
  getCalls(callerId: string, receiverId: string): Promise<Call[]>;
  createCall(
    callerId: string,
    receiverId: string,
    status: "request" | "accepted" | "rejected" | "ended" | "busy",
  ): Promise<Call>;
  updateCallStatus(
    callId: number,
    status: "request" | "accepted" | "rejected" | "ended" | "busy",
  ): Promise<Call | undefined>;
}

export class MemStorage implements IStorage {
  private relievers: Map<number, Reliever>;
  private messages: Map<number, Message>;
  private calls: Map<number, Call>; // New map for calls
  private currentRelieverId: number;
  private currentMessageId: number;
  private currentCallId: number;

  constructor() {
    this.relievers = new Map();
    this.messages = new Map();
    this.calls = new Map(); // Initialize calls map
    this.currentRelieverId = 1;
    this.currentMessageId = 1;
    this.currentCallId = 1;

    // Add sample relievers
    const sampleRelievers: InsertReliever[] = [
      {
        username: "tech_sarah",
        displayName: "Sarah Chen",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
        bio: "Technical support specialist with 5+ years experience in software troubleshooting",
        skills: ["JavaScript", "React", "Node.js"],
        lastActive: new Date(),
        isAvailable: true,
      },
      {
        username: "dev_mike",
        displayName: "Mike Johnson",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Mike",
        bio: "Full-stack developer passionate about helping others learn to code",
        skills: ["Python", "Django", "PostgreSQL"],
        lastActive: new Date(),
        isAvailable: true,
      },
      {
        username: "design_alex",
        displayName: "Alex Rivera",
        avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
        bio: "UI/UX designer specializing in user-centered design and accessibility",
        skills: ["UI Design", "Figma", "User Research"],
        lastActive: new Date(),
        isAvailable: false,
      },
    ];

    sampleRelievers.forEach((reliever) => {
      const id = this.currentRelieverId++;
      this.relievers.set(id, {
        ...reliever,
        id,
        isAvailable: reliever.isAvailable ?? true,
      });
    });
  }

  async getRelievers(): Promise<Reliever[]> {
    return Array.from(this.relievers.values());
  }

  async getReliever(id: number): Promise<Reliever | undefined> {
    return this.relievers.get(id);
  }

  async createReliever(insertReliever: InsertReliever): Promise<Reliever> {
    const id = this.currentRelieverId++;
    const reliever: Reliever = {
      ...insertReliever,
      id,
      isAvailable: insertReliever.isAvailable ?? true,
    };
    this.relievers.set(id, reliever);
    return reliever;
  }

  async updateRelieverStatus(
    id: number,
    isAvailable: boolean,
  ): Promise<Reliever | undefined> {
    const reliever = this.relievers.get(id);
    if (!reliever) return undefined;

    const updatedReliever = { ...reliever, isAvailable };
    this.relievers.set(id, updatedReliever);
    return updatedReliever;
  }

  async getMessages(senderId: string, receiverId: string): Promise<Message[]> {
    return Array.from(this.messages.values()).filter(
      (message) =>
        (message.senderId === senderId && message.receiverId === receiverId) ||
        (message.senderId === receiverId && message.receiverId === senderId),
    );
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = this.currentMessageId++;
    const message: Message = {
      ...insertMessage,
      id,
      isRead: insertMessage.isRead ?? false,
    };
    this.messages.set(id, message);
    return message;
  }

  async markMessageAsRead(messageId: number): Promise<void> {
    const message = this.messages.get(messageId);
    if (message) {
      this.messages.set(messageId, { ...message, isRead: true });
    }
  }

  // New methods for calls (optional for voice chat)
  async getCalls(callerId: string, receiverId: string): Promise<Call[]> {
    return Array.from(this.calls.values()).filter(
      (call) =>
        (call.callerId === callerId && call.receiverId === receiverId) ||
        (call.callerId === receiverId && call.receiverId === callerId),
    );
  }

  async createCall(
    callerId: string,
    receiverId: string,
    status: "request" | "accepted" | "rejected" | "ended" | "busy",
  ): Promise<Call> {
    const id = this.currentCallId++;
    const call: Call = {
      id,
      callerId,
      receiverId,
      status,
      timestamp: new Date(),
    };
    this.calls.set(id, call);
    return call;
  }

  async updateCallStatus(
    callId: number,
    status: "request" | "accepted" | "rejected" | "ended" | "busy",
  ): Promise<Call | undefined> {
    const call = this.calls.get(callId);
    if (!call) return undefined;

    const updatedCall = { ...call, status, timestamp: new Date() };
    this.calls.set(callId, updatedCall);
    return updatedCall;
  }
}

export const storage = new MemStorage();
