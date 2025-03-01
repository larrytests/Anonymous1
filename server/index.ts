import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { Server } from "socket.io"; // Import Socket.io server
import http from "http"; // Import HTTP server for Socket.io

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Create an HTTP server instead of using Express directly for Socket.io
  const server = http.createServer(app);
  registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Set up Socket.io server
  const io = new Server(server, {
    cors: {
      origin: "*", // Adjust this for production to match your client URL
      methods: ["GET", "POST"],
    },
  });

  // Handle Socket.io connections and voice chat signaling
  io.on("connection", (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // Relay messages between clients for voice chat and text chat
    socket.on("message", (message: any) => {
      socket.broadcast.emit("message", message);
    });

    socket.on("voice_call", (message: any) => {
      socket.broadcast.emit("voice_call", message);
    });

    socket.on("ice-candidate", (message: any) => {
      socket.broadcast.emit("ice-candidate", message);
    });

    socket.on("typing", (message: any) => {
      socket.broadcast.emit("typing", message);
    });

    socket.on("user_connected", (message: any) => {
      socket.broadcast.emit("user_connected", message);
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  // Set up Vite or static serving based on environment
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Serve the app on port 5000 (both API and client, including Socket.io)
  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    log(`Serving on port ${PORT} (HTTP and WebSocket)`);
  });
})();