import React, { useState, useEffect, useRef } from "react"; // Added React and useRef import
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Auth from "@/pages/auth";
import NotFound from "@/pages/not-found";
import { auth } from "@/lib/firebase";
import { io, Socket } from "socket.io-client";
import { ChatService } from "@/lib/chat";

const SocketContext = React.createContext<Socket | null>(null);

function Router() {
  const socket = useRef<Socket | null>(null);
  const [chatService, setChatService] = useState<ChatService | null>(null);

  useEffect(() => {
    socket.current = io(window.location.origin, {
      transports: ['websocket'],
      auth: {
        token: auth.currentUser ? async () => await auth.currentUser!.getIdToken() : undefined,
        userId: auth.currentUser ? auth.currentUser.uid : undefined,
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    const service = new ChatService();
    setChatService(service);

    return () => {
      socket.current?.disconnect();
      service.close();
    };
  }, []);

  return (
    <SocketContext.Provider value={socket.current}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/auth" component={Auth} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/chat/:id" component={Chat} />
        <Route component={NotFound} />
      </Switch>
    </SocketContext.Provider>
  );
}

function App() {
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      setIsFirebaseInitialized(true);
    });

    return () => unsubscribe();
  }, []);

  if (!isFirebaseInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;