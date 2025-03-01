import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Reliever schema (unchanged)
export const relievers = pgTable("relievers", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  bio: text("bio").notNull(),
  skills: text("skills").array().notNull(),
  lastActive: timestamp("last_active").notNull(),
  isAvailable: boolean("is_available").notNull().default(true),
});

// Messages schema (unchanged)
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  receiverId: text("receiver_id").notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  isRead: boolean("is_read").notNull().default(false),
});

// Schemas for inserting data (unchanged)
export const insertRelieverSchema = createInsertSchema(relievers).omit({
  id: true,
});
export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
});

// Types (unchanged)
export type Reliever = typeof relievers.$inferSelect;
export type InsertReliever = z.infer<typeof insertRelieverSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Enhanced ChatMessage interface for voice chat
export interface ChatMessage {
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