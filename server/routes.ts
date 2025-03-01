import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { type ChatMessage } from "@shared/schema";

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  console.log("Initializing Socket.IO server...");

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ['websocket', 'polling'],
  });

  console.log("Socket.IO server initialized");

  // Store active clients
  const clients = new Map<string, Set<string>>(); // userId -> Set of socketIds

  io.on("connection", (socket) => {
    let currentUserId: string | null = null;

    socket.emit("connection_status", {
      type: "connection_status",
      connectionStatus: "connected",
      timestamp: new Date().toISOString(),
    });

    socket.on("user_connected", (message: ChatMessage) => {
      if (!message.senderId) return;

      currentUserId = message.senderId;
      const userSockets = clients.get(currentUserId) || new Set();
      userSockets.add(socket.id);
      clients.set(currentUserId, userSockets);

      io.emit("user_status", {
        type: 'user_connected',
        userId: currentUserId,
        connectionStatus: 'connected',
        timestamp: new Date().toISOString(),
      });
    });

    const messageCache = new Set<string>();

    socket.on("message", (message: ChatMessage) => {
      console.log("Received message:", message);

      const messageId = `${message.senderId}-${message.timestamp}-${message.content || JSON.stringify(message.callData)}`;
      if (messageCache.has(messageId)) {
        return; // Skip duplicate message
      }
      messageCache.add(messageId);

      if (message.receiverId) {
        const recipientSocketIds = clients.get(message.receiverId);
        if (recipientSocketIds) {
          // Send only to the first active socket for this user
          const firstSocketId = Array.from(recipientSocketIds)[0];
          io.to(firstSocketId).emit("message", {
            ...message,
            timestamp: new Date().toISOString(),
          });
        } else {
          console.log(`Recipient not found: ${message.receiverId}`);
          if (message.type === 'voice_call' && message.callData?.type === 'request' && message.senderId) {
            const senderSocketIds = clients.get(message.senderId);
            if (senderSocketIds) {
              senderSocketIds.forEach(senderSocketId => {
                io.to(senderSocketId).emit("message", {
                  type: 'voice_call',
                  senderId: message.receiverId,
                  receiverId: message.senderId,
                  callData: { type: 'busy' },
                  timestamp: new Date().toISOString(),
                });
              });
            }
          }
        }
      }
    });

    socket.on("typing", (message: ChatMessage) => {
      if (message.receiverId) {
        const recipientSocketIds = clients.get(message.receiverId);
        if (recipientSocketIds) {
          recipientSocketIds.forEach(recipientSocketId => {
            io.to(recipientSocketId).emit("typing", {
              ...message,
              timestamp: new Date().toISOString(),
            });
          });
        }
      }
    });

    // Handle voice call signaling
    socket.on("voice_call", (message: ChatMessage) => {
      if (message.receiverId) {
        const recipientSocketIds = clients.get(message.receiverId);
        if (recipientSocketIds) {
          // Send to all active sockets for the recipient
          recipientSocketIds.forEach(recipientSocketId => {
            io.to(recipientSocketId).emit("voice_call", {
              ...message,
              timestamp: new Date().toISOString(),
            });
          });
        } else if (message.callData?.type === 'request' && message.senderId) {
          // If recipient is not online, send 'busy' response to sender
          const senderSocketIds = clients.get(message.senderId);
          if (senderSocketIds) {
            senderSocketIds.forEach(senderSocketId => {
              io.to(senderSocketId).emit("voice_call", {
                type: 'voice_call',
                senderId: message.receiverId,
                receiverId: message.senderId,
                callData: { type: 'busy' },
                timestamp: new Date().toISOString(),
              });
            });
          }
        }
      }
    });

    // Handle WebRTC ICE candidates
    socket.on("ice-candidate", (message: ChatMessage) => {
      if (message.receiverId) {
        const recipientSocketIds = clients.get(message.receiverId);
        if (recipientSocketIds) {
          // Send to all active sockets for the recipient
          recipientSocketIds.forEach(recipientSocketId => {
            io.to(recipientSocketId).emit("ice-candidate", {
              ...message,
              timestamp: new Date().toISOString(),
            });
          });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);

      if (currentUserId) {
        const userSockets = clients.get(currentUserId);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            clients.delete(currentUserId);
          }
          console.log("User disconnected and removed:", currentUserId);

          // Broadcast disconnection
          io.emit("user_status", {
            type: 'user_connected',
            userId: currentUserId,
            connectionStatus: 'disconnected',
            timestamp: new Date().toISOString(),
          });
        }
      }

      console.log("Remaining active clients:", Array.from(clients.keys()));
    });
  });

  // Rest of the routes
  app.get("/api/relievers", async (_req, res) => {
    try {
      const relievers = await storage.getRelievers();
      res.json(relievers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch relievers" });
    }
  });

  return httpServer;
}