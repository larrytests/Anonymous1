import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import RelieverCard from "@/components/reliever-card";
import { signInAnonymousUser, db, rdb } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { ref, set } from "firebase/database";
import type { Reliever } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { ChatService } from "@/lib/chat";

export default function Home() {
  const [, navigate] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [relievers, setRelievers] = useState<Reliever[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const { toast } = useToast();
  const chatServiceRef = useRef<ChatService | null>(null);

  useEffect(() => {
    const relieversRef = collection(db, "relievers");
    const q = query(relieversRef, where("isAvailable", "==", true));

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Reliever[];
        setRelievers(data);
        setIsLoading(false);
      },
      (err) => {
        console.error('Failed to fetch relievers:', err);
        setError(err.message);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleConnect = async (relieverId: string) => {
    if (isConnecting) return;

    try {
      setIsConnecting(true);
      setConnectionStatus('connecting');
      setError(null);

      // Sign in anonymously first
      const userCredential = await signInAnonymousUser();
      const userId = userCredential?.uid;

      if (!userId) {
        throw new Error('Failed to authenticate user');
      }

      // Initialize chat service
      chatServiceRef.current = new ChatService();

      // Subscribe to connection status
      const unsubscribe = chatServiceRef.current.onMessage((message) => {
        if (message.type === 'connection_status') {
          setConnectionStatus(message.connectionStatus || 'disconnected');

          if (message.connectionStatus === 'connected') {
            initializeChat(relieverId, userId);
          }
        }
      });

      // Add cleanup function
      return () => {
        unsubscribe();
        if (chatServiceRef.current) {
          chatServiceRef.current.close();
          chatServiceRef.current = null;
        }
      };

    } catch (error) {
      console.error("Error connecting:", error);
      setError(error instanceof Error ? error.message : 'An unknown error occurred');
      toast({
        title: "Connection Error",
        description: "Failed to connect to chat. Please try again.",
        variant: "destructive"
      });
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    }
  };

  const initializeChat = async (relieverId: string, userId: string) => {
    try {
      // Add user to the reliever's queue
      const queueRef = ref(rdb, `queue/${relieverId}/${userId}`);
      await set(queueRef, {
        userName: `User_${userId.slice(0, 6)}`,
        joinedAt: new Date().toISOString()
      });

      // Initialize chat structure
      const chatRef = ref(rdb, `chats/${relieverId}/${userId}`);
      await set(chatRef, {
        userName: `User_${userId.slice(0, 6)}`,
        lastMessage: "Chat initiated",
        timestamp: new Date().toISOString(),
        status: 'queued'
      });

      // Navigate to chat page
      navigate(`/chat/${relieverId}`);

    } catch (error) {
      console.error("Error initializing chat:", error);
      setError(error instanceof Error ? error.message : 'Failed to initialize chat');
      toast({
        title: "Setup Error",
        description: "Failed to initialize chat. Please try again.",
        variant: "destructive"
      });
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    }
  };

  const filteredRelievers = relievers.filter(
    (reliever) =>
      reliever.skills.some((skill) =>
        skill.toLowerCase().includes(searchTerm.toLowerCase()),
      ) ||
      reliever.displayName.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-8 h-8 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <span className="text-xl font-bold">Relief Chat</span>
          </div>
          <Button onClick={() => navigate("/auth")} variant="outline">
            Reliever Login
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-destructive">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="max-w-3xl mx-auto text-center mb-12">
              <h1 className="text-4xl font-bold mb-4">
                Connect with Expert Support
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Get instant help from our qualified relievers. No registration
                required.
              </p>
              <Input
                type="search"
                placeholder="Search by skills or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md mx-auto"
              />
            </div>

            {isConnecting && (
              <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-4">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground">
                  {connectionStatus === 'connected' ? 'Connected to support' :
                    connectionStatus === 'connecting' ? 'Connecting to support...' : 'Connection failed, retrying...'}
                </p>
                {error && (
                  <p className="text-destructive text-sm">{error}</p>
                )}
              </div>
            )}

            {!isConnecting && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredRelievers.length > 0 ? (
                  filteredRelievers.map((reliever) => (
                    <RelieverCard
                      key={reliever.id}
                      reliever={reliever}
                      onConnect={() => handleConnect(reliever.id)}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-12">
                    <p className="text-muted-foreground">
                      {searchTerm
                        ? "No relievers found matching your search."
                        : "No relievers are currently available."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}