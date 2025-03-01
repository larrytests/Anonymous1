import { useEffect, useState, useRef } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { auth, rdb } from "@/lib/firebase";
import { ref, onValue, set, update, get } from "firebase/database";
import { useToast } from "@/hooks/use-toast";
import ChatWindow from "@/components/chat-window";
import { ChatService } from "@/lib/chat";
import { Smile, Send, Mic, MicOff, PhoneOff, Phone } from "lucide-react";
import EmojiPicker from "emoji-picker-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ringtoneService } from "@/lib/ringtone";
import { type Message } from "@shared/schema";

type CallStatus = "idle" | "requesting" | "incoming" | "connected";
type ConnectingStatus = "connecting" | "notConnecting";

export default function Chat() {
  const { id } = useParams();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [remoteIsTyping, setRemoteIsTyping] = useState(false);
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [incomingCallerId, setIncomingCallerId] = useState<string | null>(null);
  const [showCallModal, setShowCallModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState<ConnectingStatus>("notConnecting");

  const messageEndRef = useRef<HTMLDivElement>(null);
  const chatServiceRef = useRef<ChatService | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  // Flag to ensure answer is only processed once.
  const remoteAnswerSetRef = useRef(false);

  // Caller initiates the call
  const initializeVoiceCall = async () => {
    if (callStatus !== "idle") {
      toast({
        title: "Call in Progress",
        description: "Please end the current call first",
        duration: 3000,
      });
      return;
    }
    try {
      setIsConnecting("connecting");
      setCallStatus("requesting");
      setShowCallModal(true);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Local stream tracks:", stream.getTracks());
      localStreamRef.current = stream;

      const configuration = {
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
          {
            urls: [
              "turn:openrelay.metered.ca:80",
              "turn:openrelay.metered.ca:443",
              "turn:openrelay.metered.ca:443?transport=tcp",
            ],
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10,
      };

      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      // Set up ontrack on caller side to handle remote audio
      peerConnection.ontrack = (event) => {
        console.log("Received remote track on caller side:", event);
        const [remoteStream] = event.streams;
        console.log("Remote stream tracks:", remoteStream.getTracks());
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
          // Append audio element to DOM to prevent garbage collection
          document.body.appendChild(remoteAudioRef.current);
        }
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.onloadedmetadata = () => {
          remoteAudioRef.current?.play().catch((error) => {
            console.error("Error playing remote audio (caller):", error);
            toast({ title: "Audio Error", description: "Failed to play remote audio. Check your speakers.", variant: "destructive" });
          });
        };
      };

      peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", peerConnection.iceConnectionState);
        switch (peerConnection.iceConnectionState) {
          case "checking":
            toast({ title: "Connecting", description: "Establishing connection..." });
            break;
          case "connected":
            toast({ title: "Connected", description: "Call connected successfully" });
            break;
          case "disconnected":
            toast({
              title: "Disconnected",
              description: "Call connection lost, trying to reconnect...",
            });
            peerConnection.restartIce();
            break;
          case "failed":
            toast({
              title: "Connection Failed",
              description: "Check your network connection",
              variant: "destructive",
            });
            handleEndCall();
            break;
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log("Connection state:", peerConnection.connectionState);
        if (peerConnection.connectionState === "failed") {
          toast({
            title: "Connection Lost",
            description: "Call ended due to connection failure",
            variant: "destructive",
          });
          handleEndCall();
        }
      };

      peerConnection.onicegatheringstatechange = () => {
        console.log("ICE gathering state:", peerConnection.iceGatheringState);
      };

      peerConnection.onerror = (error) => {
        console.error("PeerConnection error:", error);
        toast({
          title: "Call Error",
          description: "An error occurred during the call",
          variant: "destructive",
        });
        handleEndCall();
      };

      const offer = await peerConnection.createOffer({ offerToReceiveAudio: true });
      await peerConnection.setLocalDescription(offer);

      if (!auth.currentUser?.uid || !id) throw new Error("User not authenticated");

      const offerPath = `calls/${auth.currentUser.uid}/${id}/offer`;
      console.log("Storing offer at:", offerPath);
      await set(ref(rdb, offerPath), {
        offer: offer,
        type: "offer",
        timestamp: new Date().toISOString(),
      });

      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log("ICE candidate generated:", event.candidate);
          const icePath = `calls/${auth.currentUser.uid}/${id}/ice-candidates/${Date.now()}`;
          await set(ref(rdb, icePath), {
            ...event.candidate.toJSON(),
            timestamp: new Date().toISOString(),
          });
        }
      };

      onValue(ref(rdb, `calls/${id}/${auth.currentUser.uid}/answer`), async (snapshot) => {
        const answerData = snapshot.val();
        if (answerData?.answer && peerConnectionRef.current && !remoteAnswerSetRef.current) {
          if (peerConnectionRef.current.signalingState === "have-local-offer") {
            console.log("Received answer:", answerData);
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answerData.answer));
            remoteAnswerSetRef.current = true;
            setCallStatus("connected");
            setShowCallModal(true);
          } else {
            console.warn("Received answer in wrong signaling state:", peerConnectionRef.current.signalingState);
          }
        }
      });

      onValue(ref(rdb, `calls/${id}/${auth.currentUser.uid}/ice-candidates`), async (snapshot) => {
        const candidates = snapshot.val();
        if (candidates && peerConnectionRef.current) {
          for (const key in candidates) {
            const candidateData = candidates[key];
            console.log("Adding ICE candidate:", candidateData);
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidateData));
          }
        }
      });

      if (chatServiceRef.current) {
        chatServiceRef.current.sendMessage(
          {
            type: "voice_call",
            senderId: auth.currentUser.uid,
            receiverId: id,
            callData: { type: "request" },
            timestamp: new Date().toISOString(),
          },
          (ack) => {
            if (ack?.success) console.log("Call request delivered");
            else console.error("Call request delivery failed");
          }
        );
      }

      setTimeout(() => {
        if (callStatus === "requesting") {
          handleEndCall();
          toast({ title: "Call Timeout", description: "No answer.", duration: 3000 });
        }
      }, 30000);
    } catch (error) {
      console.error("Voice call error:", error);
      handleEndCall();
      toast({ title: "Call Error", description: "Failed to start call.", variant: "destructive" });
    } finally {
      setIsConnecting("notConnecting");
    }
  };

  // Process incoming call requests
  const handleIncomingCall = (callData: any, senderId: string) => {
    console.log("Incoming call message received:", { callData, senderId });
    if (callData.type === "request") {
      setCallStatus("incoming");
      setIncomingCallerId(senderId);
      setShowCallModal(true);
      console.log("Starting ringtone on incoming call");
      ringtoneService.startRinging();
      toast({
        title: "Incoming Call",
        description: "Someone is calling you",
        duration: 30000,
        action: (
          <div className="flex gap-2">
            <Button onClick={handleAcceptCall} className="bg-green-500 hover:bg-green-600">
              Accept
            </Button>
            <Button onClick={handleRejectCall} variant="destructive">
              Reject
            </Button>
          </div>
        ),
      });
    } else if (callData.type === "accepted") {
      setCallStatus("connected");
      setShowCallModal(true);
      ringtoneService.stopRinging();
      toast({ title: "Call Connected", description: "You're now connected", duration: 3000 });
    } else if (["ended", "rejected", "busy"].includes(callData.type)) {
      handleEndCall();
      toast({ title: `Call ${callData.type}`, description: `Call ${callData.type}.`, duration: 3000 });
    }
  };

  // When accepting an incoming call, set up the RTCPeerConnection
  const handleAcceptCall = async () => {
    if (!incomingCallerId || !auth.currentUser) return;
    try {
      const permissions = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (permissions.state === "denied") throw new Error("Microphone permission denied");

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioDevices = devices.filter((device) => device.kind === "audioinput");
      if (audioDevices.length === 0) throw new Error("No audio input devices found");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: audioDevices[0].deviceId },
      });
      console.log("Accepted call local stream tracks:", stream.getTracks());
      localStreamRef.current = stream;

      navigator.mediaDevices.ondevicechange = async () => {
        const newDevices = await navigator.mediaDevices.enumerateDevices();
        const newAudioDevices = newDevices.filter((device) => device.kind === "audioinput");
        if (newAudioDevices.length === 0) {
          toast({ title: "Device Error", description: "Audio input device disconnected", variant: "destructive" });
          handleEndCall();
        }
      };

      const configuration = {
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
          {
            urls: [
              "turn:openrelay.metered.ca:80",
              "turn:openrelay.metered.ca:443",
              "turn:openrelay.metered.ca:443?transport=tcp",
            ],
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
        iceTransportPolicy: "all",
        iceCandidatePoolSize: 10,
      };

      const peerConnection = new RTCPeerConnection(configuration);
      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      // REMOTE TRACK HANDLER (Receiver Side)
      peerConnection.ontrack = (event) => {
        console.log("Received remote track (accept call):", event);
        const [remoteStream] = event.streams;
        console.log("Remote stream tracks:", remoteStream.getTracks());
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
          // Append audio element to DOM to prevent garbage collection
          document.body.appendChild(remoteAudioRef.current);
        }
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.onloadedmetadata = () => {
          remoteAudioRef.current?.play().catch((error) => {
            console.error("Error playing remote audio (accept call):", error);
            toast({ title: "Audio Error", description: "Failed to play remote audio. Check your speakers.", variant: "destructive" });
          });
        };
      };

      // Fetch the caller's offer from Firebase
      const offerPath = `calls/${incomingCallerId}/${auth.currentUser.uid}/offer`;
      console.log("Fetching offer from:", offerPath);
      const offerSnapshot = await get(ref(rdb, offerPath));
      const offerData = offerSnapshot.val();
      if (!offerData?.offer) throw new Error("Offer not found");
      console.log("Offer retrieved:", offerData);

      await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      const answerPath = `calls/${auth.currentUser.uid}/${incomingCallerId}/answer`;
      console.log("Storing answer at:", answerPath);
      await set(ref(rdb, answerPath), {
        answer: answer,
        type: "answer",
        timestamp: new Date().toISOString(),
      });

      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log("ICE candidate generated (accept call):", event.candidate);
          const icePath = `calls/${auth.currentUser.uid}/${incomingCallerId}/ice-candidates/${Date.now()}`;
          await set(ref(rdb, icePath), {
            ...event.candidate.toJSON(),
            timestamp: new Date().toISOString(),
          });
        }
      };

      onValue(ref(rdb, `calls/${incomingCallerId}/${auth.currentUser.uid}/ice-candidates`), async (snapshot) => {
        const candidates = snapshot.val();
        if (candidates && peerConnectionRef.current) {
          for (const key in candidates) {
            const candidateData = candidates[key];
            console.log("Adding ICE candidate (accept call):", candidateData);
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidateData));
          }
        }
      });

      setCallStatus("connected");
      setShowCallModal(true);
      ringtoneService.stopRinging();

      if (chatServiceRef.current) {
        chatServiceRef.current.sendMessage(
          {
            type: "voice_call",
            senderId: auth.currentUser.uid,
            receiverId: incomingCallerId,
            callData: { type: "accepted" },
            timestamp: new Date().toISOString(),
          },
          (ack) => {
            if (ack?.success) console.log("Call accepted message delivered");
            else console.error("Failed to deliver call accepted message");
          }
        );
      }
    } catch (error) {
      console.error("Error accepting call:", error);
      handleEndCall();
      toast({ title: "Call Error", description: "Failed to accept call.", variant: "destructive" });
    }
  };

  const handleRejectCall = () => {
    if (!incomingCallerId || !auth.currentUser) return;
    ringtoneService.stopRinging();
    if (chatServiceRef.current) {
      chatServiceRef.current.sendMessage(
        {
          type: "voice_call",
          senderId: auth.currentUser.uid,
          receiverId: incomingCallerId,
          callData: { type: "rejected" },
          timestamp: new Date().toISOString(),
        },
        (ack) => {
          if (ack?.success) console.log("Call rejected message delivered");
          else console.error("Failed to deliver call rejected message");
        }
      );
    }
    setCallStatus("idle");
    setIncomingCallerId(null);
    setShowCallModal(false);
  };

  const handleEndCall = () => {
    console.log("Ending call...");
    if (callStatus === "idle" && !localStreamRef.current && !peerConnectionRef.current) return;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
          track.enabled = false;
        } catch (e) {
          console.error("Error stopping track:", e);
        }
      });
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.oniceconnectionstatechange = null;
        peerConnectionRef.current.onicegatheringstatechange = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.onerror = null;
        peerConnectionRef.current.getSenders().forEach((sender) => {
          if (sender.track) {
            sender.track.stop();
          }
          try {
            peerConnectionRef.current?.removeTrack(sender);
          } catch (e) {
            console.error("Error removing track:", e);
          }
        });
        peerConnectionRef.current.close();
      } catch (e) {
        console.error("Error cleaning up peer connection:", e);
      } finally {
        peerConnectionRef.current = null;
      }
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      // Remove audio element from DOM
      if (remoteAudioRef.current.parentNode) {
        remoteAudioRef.current.parentNode.removeChild(remoteAudioRef.current);
      }
      remoteAudioRef.current = null;
    }

    setCallStatus("idle");
    setShowCallModal(false);
    setIncomingCallerId(null);
    setIsMuted(false);
    ringtoneService.stopRinging();

    if (auth.currentUser?.uid && id) {
      Promise.all([
        set(ref(rdb, `calls/${auth.currentUser.uid}/${id}`), null),
        set(ref(rdb, `calls/${id}/${auth.currentUser.uid}`), null),
      ]).catch((error) => console.error("Error cleaning up Firebase:", error));
    }

    if (chatServiceRef.current && id) {
      const sendEndCallMessage = () => {
        chatServiceRef.current?.sendMessage(
          {
            type: "voice_call",
            senderId: auth.currentUser?.uid,
            receiverId: id,
            callData: { type: "ended" },
            timestamp: new Date().toISOString(),
          },
          (ack) => {
            if (!ack?.success) {
              console.error("Failed to deliver call ended message");
            }
          }
        );
      };
      sendEndCallMessage();
      setTimeout(sendEndCallMessage, 500);
      setTimeout(sendEndCallMessage, 1000);
    }

    setShowCallModal(false);
    setTimeout(() => {
      setCallStatus("idle");
      setIncomingCallerId(null);
      setIsMuted(false);
    }, 100);
  };

  const handleMuteToggle = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  useEffect(() => {
    if (!auth.currentUser || !id) return;
    handleEndCall();

    const chatService = new ChatService();
    chatServiceRef.current = chatService;

    const unsubscribeChat = chatService.onMessage((message) => {
      console.log("Chat Socket.IO message:", message);
      if (message.type === "connection_status") {
        setConnectionStatus(message.connectionStatus || "disconnected");
      } else if (message.type === "message" && message.content && message.senderId) {
        setMessages((prev) => {
          const newMessage: Message = {
            content: message.content,
            senderId: message.senderId,
            timestamp: message.timestamp || new Date().toISOString(),
            isRead: false,
          };
          return prev.some((m) => m.content === newMessage.content && m.timestamp === newMessage.timestamp)
            ? prev
            : [...prev, newMessage];
        });
      } else if (message.type === "typing" && message.senderId !== auth.currentUser.uid) {
        setRemoteIsTyping(message.isTyping || false);
      } else if (message.type === "voice_call" && message.senderId && message.callData) {
        handleIncomingCall(message.callData, message.senderId);
      }
    });

    const chatRef = ref(rdb, `messages/${id}/${auth.currentUser.uid}`);
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const messageList: Message[] = [];
      snapshot.forEach((childSnapshot) => {
        const message = childSnapshot.val();
        messageList.push({
          id: childSnapshot.key,
          ...message,
        });
      });
      setMessages(
        messageList.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      );
      setIsLoading(false);
    });

    const scrollTimeout = setTimeout(() => {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);

    return () => {
      unsubscribeChat();
      unsubscribe();
      if (chatServiceRef.current) {
        chatServiceRef.current.close();
        chatServiceRef.current = null;
      }
      clearTimeout(scrollTimeout);
    };
  }, [id, toast]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (chatServiceRef.current && id) {
      chatServiceRef.current.sendTypingIndicator(id, value.length > 0);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !auth.currentUser || !id) return;
    try {
      const message: Message = {
        content: inputValue.trim(),
        senderId: auth.currentUser.uid,
        timestamp: new Date().toISOString(),
        isRead: false,
      };
      if (chatServiceRef.current) {
        chatServiceRef.current.sendMessage(
          {
            type: "message",
            content: message.content,
            senderId: message.senderId,
            receiverId: id,
            timestamp: message.timestamp,
          },
          (ack) => {
            if (ack?.success) console.log("Message delivered");
            else console.error("Message delivery failed");
          }
        );
      }
      const timestamp = new Date(message.timestamp).getTime();
      const updates: { [key: string]: any } = {};
      updates[`messages/${auth.currentUser.uid}/${id}/${timestamp}`] = message;
      updates[`messages/${id}/${auth.currentUser.uid}/${timestamp}`] = message;
      await update(ref(rdb), updates);
      setInputValue("");
    } catch (error) {
      console.error("Error sending message:", error);
      toast({ title: "Error", description: "Failed to send message.", variant: "destructive" });
    }
  };

  const onEmojiClick = (emojiData: any) => {
    setInputValue((prev) => prev + emojiData.emoji);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 h-screen flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className={`flex items-center gap-2 p-2 rounded-md ${
          connectionStatus === "connected" ? "bg-green-50 text-green-700" :
          connectionStatus === "connecting" ? "bg-yellow-50 text-yellow-700" : "bg-red-50 text-red-700"
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            connectionStatus === "connected" ? "bg-green-500" :
            connectionStatus === "connecting" ? "bg-yellow-500" : "bg-red-500"
          }`} />
          <span className="text-sm font-medium capitalize">
            {connectionStatus === "connected" ? "Connected to support" :
             connectionStatus === "connecting" ? "Connecting..." : "Disconnected"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {callStatus === "connected" && (
            <Button onClick={handleMuteToggle} variant={isMuted ? "destructive" : "ghost"} size="icon" className="h-10 w-10">
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
          )}
          {callStatus === "incoming" ? (
            <>
              <Button onClick={handleAcceptCall} variant="default" size="icon" className="h-10 w-10 bg-green-500 hover:bg-green-600">
                <Phone className="h-5 w-5" />
              </Button>
              <Button onClick={handleRejectCall} variant="destructive" size="icon" className="h-10 w-10">
                <PhoneOff className="h-5 w-5" />
              </Button>
            </>
          ) : (
            <Button
              onClick={callStatus === "idle" ? initializeVoiceCall : handleEndCall}
              variant={callStatus !== "idle" ? "destructive" : "default"}
              size="icon"
              className={`h-10 w-10 ${callStatus === "requesting" ? "animate-pulse" : ""}`}
            >
              {callStatus !== "idle" ? <PhoneOff className="h-5 w-5" /> : <Phone className="h-5 w-5" />}
            </Button>
          )}
        </div>
      </div>

      {showCallModal && callStatus !== "idle" && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="text-center">
              <div className="mb-4">
                {callStatus === "requesting" && <Phone className="h-12 w-12 mx-auto text-primary animate-bounce" />}
                {callStatus === "incoming" && <Phone className="h-12 w-12 mx-auto text-green-500 animate-pulse" />}
                {callStatus === "connected" && <Mic className="h-12 w-12 mx-auto text-primary" />}
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {callStatus === "requesting" && "Calling..."}
                {callStatus === "incoming" && "Incoming Call"}
                {callStatus === "connected" && "On Call"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {callStatus === "requesting" && "Waiting for answer..."}
                {callStatus === "incoming" && "Someone is calling you"}
                {callStatus === "connected" && "Call in progress"}
              </p>
              <div className="flex justify-center gap-4">
                {callStatus === "incoming" ? (
                  <>
                    <Button onClick={handleAcceptCall} className="bg-green-500 hover:bg-green-600">
                      Accept
                    </Button>
                    <Button onClick={handleRejectCall} variant="destructive">
                      Reject
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleEndCall} variant="destructive" className="w-full">
                    End Call
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Card className="flex-1 bg-[#E5DDD5] dark:bg-gray-900 overflow-hidden">
        <ChatWindow messages={messages} currentUserId={auth.currentUser?.uid} isTyping={remoteIsTyping} />
        <div ref={messageEndRef} />
      </Card>

      <div className="flex items-center gap-2 mt-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10">
              <Smile className="h-6 w-6" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0">
            <EmojiPicker onEmojiClick={onEmojiClick} width="100%" />
          </PopoverContent>
        </Popover>

        <Input
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyPress={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          className="flex-1"
          disabled={connectionStatus !== "connected"}
        />

        <Button onClick={handleSend} disabled={connectionStatus !== "connected"} size="icon" className="h-10 w-10">
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}