import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { auth, db, rdb } from "@/lib/firebase";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";
import { ref, onValue, set } from "firebase/database";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserCircle, MessageSquare, Clock, Users, BarChart, LogOut, Phone, PhoneOff } from "lucide-react";
import type { Reliever } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { ChatService } from "@/lib/chat";

interface ChatSession {
  id: string;
  userName: string;
  lastMessage: string;
  timestamp: Date;
  status: 'active' | 'ended';
}

interface QueuedUser {
  id: string;
  userName: string;
  joinedAt: Date;
}

interface CallNotification {
  callerId: string;
  callStatus: 'incoming' | 'connected' | 'ended' | 'rejected' | 'busy';
  timestamp: Date;
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeChats, setActiveChats] = useState<ChatSession[]>([]);
  const [queuedUsers, setQueuedUsers] = useState<QueuedUser[]>([]);
  const [relieverProfile, setRelieverProfile] = useState<Reliever | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
  const [callNotification, setCallNotification] = useState<CallNotification | null>(null);

  useEffect(() => {
    if (!auth.currentUser) {
      navigate("/auth");
      return;
    }

    let chatService: ChatService | null = null;

    try {
      const uid = auth.currentUser.uid;
      chatService = new ChatService();

      const unsubscribeChat = chatService.onMessage((message) => {
        console.log("Received Socket.IO message:", message);
        if (message.type === 'connection_status') {
          setConnectionStatus(message.connectionStatus || 'disconnected');
        } else if (message.type === 'user_connected') {
          toast({
            title: "User Connection",
            description: `User ${message.userId?.slice(0, 6)} has ${message.connectionStatus === 'disconnected' ? 'disconnected' : 'connected'}`,
            duration: 3000,
          });
        } else if (message.type === 'voice_call' && message.senderId && message.callData) {
          const callTime = new Date(message.timestamp || new Date().toISOString());
          switch (message.callData.type) {
            case 'incoming':
              setCallNotification({
                callerId: message.senderId,
                callStatus: 'incoming',
                timestamp: callTime,
              });
              toast({
                title: "Incoming Voice Call",
                description: `User ${message.senderId.slice(0, 6)} is calling you`,
                duration: 30000,
                action: (
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      onClick={() => handleAcceptVoiceCall(message.senderId)}
                      className="bg-green-500 hover:bg-green-600"
                    >
                      Accept
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => handleRejectVoiceCall(message.senderId)}
                    >
                      Reject
                    </Button>
                  </div>
                ),
              });
              break;
            case 'accepted':
              setCallNotification({
                callerId: message.senderId,
                callStatus: 'connected',
                timestamp: callTime,
              });
              toast({
                title: "Call Connected",
                description: `You are now connected with ${message.senderId.slice(0, 6)}`,
                duration: 3000,
              });
              break;
            case 'ended':
            case 'rejected':
            case 'busy':
              setCallNotification(null);
              toast({
                title: `Call ${message.callData.type === 'busy' ? 'Busy' : message.callData.type === 'rejected' ? 'Rejected' : 'Ended'}`,
                description: `Call with ${message.senderId.slice(0, 6)} has ${message.callData.type}`,
                duration: 3000,
              });
              break;
          }
        }
      });

      const relieverRef = doc(db, "relievers", uid);
      const unsubscribeReliever = onSnapshot(
        relieverRef,
        (doc) => {
          if (doc.exists()) {
            setRelieverProfile({
              id: doc.id,
              ...doc.data(),
            } as Reliever);
          }
          setIsLoading(false);
        },
        (error) => {
          console.error("Error fetching reliever profile:", error);
          setError(error);
          setIsLoading(false);
        }
      );

      const activeChatRef = ref(rdb, `chats/${uid}/active`);
      const unsubscribeChats = onValue(
        activeChatRef,
        (snapshot) => {
          const chats: ChatSession[] = [];
          snapshot.forEach((childSnapshot) => {
            const chat = childSnapshot.val();
            chats.push({
              id: childSnapshot.key,
              ...chat,
              timestamp: new Date(chat.timestamp),
            });
          });
          setActiveChats(chats);
        },
        (error) => {
          console.error("Error fetching active chats:", error);
          setError(error);
        }
      );

      const queueRef = ref(rdb, `queue/${uid}`);
      const unsubscribeQueue = onValue(
        queueRef,
        (snapshot) => {
          const users: QueuedUser[] = [];
          snapshot.forEach((childSnapshot) => {
            const user = childSnapshot.val();
            users.push({
              id: childSnapshot.key,
              ...user,
              joinedAt: new Date(user.joinedAt),
            });
          });
          setQueuedUsers(users);
          setIsLoading(false);
        },
        (error) => {
          console.error("Error fetching queue:", error);
          setError(error);
          setIsLoading(false);
        }
      );

      return () => {
        unsubscribeReliever();
        unsubscribeChats();
        unsubscribeQueue();
        unsubscribeChat();
        if (chatService) {
          chatService.close();
        }
      };
    } catch (error) {
      console.error("Error setting up dashboard:", error);
      setError(error as Error);
      setIsLoading(false);
    }
  }, [navigate, toast]);

  const handleStatusToggle = async (checked: boolean) => {
    if (!relieverProfile || !auth.currentUser) return;

    try {
      const relieverRef = doc(db, "relievers", auth.currentUser.uid);
      await updateDoc(relieverRef, {
        isAvailable: checked,
        lastActive: new Date(),
      });

      toast({
        title: "Status updated",
        description: `You are now ${checked ? 'available' : 'busy'}`,
      });
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      });
    }
  };

  const handleLogout = async () => {
    try {
      const chatService = new ChatService();
      chatService.close();

      await auth.signOut();
      navigate("/auth");
      toast({
        title: "Logged out",
        description: "Successfully logged out.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to log out",
        variant: "destructive",
      });
    }
  };

  const handleAcceptChat = async (userId: string) => {
    if (!auth.currentUser) return;

    try {
      const relieverId = auth.currentUser.uid;

      const queueRef = ref(rdb, `queue/${relieverId}/${userId}`);
      await set(queueRef, null);

      const chatRef = ref(rdb, `chats/${relieverId}/${userId}`);
      await set(chatRef, {
        userName: `User_${userId.slice(0, 6)}`,
        lastMessage: "Chat accepted",
        timestamp: new Date().toISOString(),
        status: 'active',
      });

      const chatService = new ChatService();
      navigate(`/chat/${userId}`);
    } catch (error) {
      console.error("Error accepting chat:", error);
      toast({
        title: "Error",
        description: "Failed to accept chat. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAcceptVoiceCall = (callerId: string) => {
    if (!auth.currentUser) return;

    const chatService = new ChatService();
    chatService.sendMessage({
      type: 'voice_call',
      senderId: auth.currentUser.uid,
      receiverId: callerId,
      callData: { type: 'accepted' },
      timestamp: new Date().toISOString(),
    }, (ack) => {
      if (ack?.success) {
        console.log("Call accepted message delivered");
      } else {
        console.error("Failed to deliver call accepted message");
      }
    });
    setCallNotification({
      callerId,
      callStatus: 'connected',
      timestamp: new Date(),
    });
    navigate(`/chat/${callerId}`);
  };

  const handleRejectVoiceCall = (callerId: string) => {
    if (!auth.currentUser) return;

    const chatService = new ChatService();
    chatService.sendMessage({
      type: 'voice_call',
      senderId: auth.currentUser.uid,
      receiverId: callerId,
      callData: { type: 'rejected' },
      timestamp: new Date().toISOString(),
    }, (ack) => {
      if (ack?.success) {
        console.log("Call rejected message delivered");
      } else {
        console.error("Failed to deliver call rejected message");
      }
    });
    setCallNotification(null);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardContent className="pt-6">
            <p className="text-destructive text-center">{error.message}</p>
            <Button
              className="w-full mt-4"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !relieverProfile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-8">
      <div className="flex flex-col md:flex-row gap-8">
        <Card className="flex-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={relieverProfile?.avatarUrl} />
                  <AvatarFallback>{relieverProfile?.displayName[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle>{relieverProfile?.displayName}</CardTitle>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-2 h-2 rounded-full ${relieverProfile?.isAvailable ? 'bg-[#57F287]' : 'bg-[#ED4245]'}`} />
                    <Switch
                      checked={relieverProfile?.isAvailable}
                      onCheckedChange={handleStatusToggle}
                    />
                    <span className="text-sm">{relieverProfile?.isAvailable ? 'Available' : 'Busy'}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`w-2 h-2 rounded-full ${
                      connectionStatus === 'connected' ? 'bg-[#57F287]' :
                      connectionStatus === 'connecting' ? 'bg-[#FEE75C]' : 'bg-[#ED4245]'
                    }`} />
                    <span className="text-sm capitalize">{connectionStatus}</span>
                  </div>
                  {callNotification && (
                    <div className="mt-2 flex items-center gap-2">
                      <Phone className={`w-4 h-4 ${
                        callNotification.callStatus === 'incoming' ? 'animate-pulse text-[#FEE75C]' :
                        callNotification.callStatus === 'connected' ? 'text-[#57F287]' : 'text-[#ED4245]'
                      }`} />
                      <span className="text-sm capitalize">
                        {callNotification.callStatus === 'incoming' && `Call from ${callNotification.callerId.slice(0, 6)}`}
                        {callNotification.callStatus === 'connected' && `On call with ${callNotification.callerId.slice(0, 6)}`}
                      </span>
                      {callNotification.callStatus === 'incoming' && (
                        <div className="flex gap-2 ml-2">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleAcceptVoiceCall(callNotification.callerId)}
                            className="bg-green-500 hover:bg-green-600"
                          >
                            <Phone className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRejectVoiceCall(callNotification.callerId)}
                          >
                            <PhoneOff className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <Button variant="outline" size="icon" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-4">{relieverProfile?.bio}</p>
            <div className="flex flex-wrap gap-2">
              {relieverProfile?.skills.map((skill, index) => (
                <Badge key={index} variant="secondary">{skill}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle>Performance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Active Chats</p>
                  <p className="text-2xl font-bold">{activeChats.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">In Queue</p>
                  <p className="text-2xl font-bold">{queuedUsers.length}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="active" className="mt-8">
        <TabsList>
          <TabsTrigger value="active">Active Chats</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <Card>
            <ScrollArea className="h-[400px]">
              <CardContent className="space-y-4">
                {activeChats.length === 0 ? (
                  <p className="text-center text-muted-foreground p-4">No active chats</p>
                ) : (
                  activeChats.map((chat) => (
                    <div key={chat.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <UserCircle className="w-10 h-10 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{chat.userName}</p>
                          <p className="text-sm text-muted-foreground">{chat.lastMessage}</p>
                        </div>
                      </div>
                      <Button variant="outline" onClick={() => navigate(`/chat/${chat.id}`)}>
                        Resume
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </ScrollArea>
          </Card>
        </TabsContent>

        <TabsContent value="queue">
          <Card>
            <ScrollArea className="h-[400px]">
              <CardContent className="space-y-4">
                {queuedUsers.length === 0 ? (
                  <p className="text-center text-muted-foreground p-4">Queue is empty</p>
                ) : (
                  queuedUsers.map((user) => (
                    <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <UserCircle className="w-10 h-10 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{user.userName}</p>
                          <p className="text-sm text-muted-foreground">
                            Waiting since {new Date(user.joinedAt).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      <Button onClick={() => handleAcceptChat(user.id)}>Accept</Button>
                    </div>
                  ))
                )}
              </CardContent>
            </ScrollArea>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}