import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { Check, CheckCheck } from "lucide-react";

interface Message {
  id?: string;
  content: string;
  senderId: string;
  timestamp: string;
  isRead: boolean;
}

interface ChatWindowProps {
  messages: Message[];
  currentUserId: string | undefined;
  onMessageRead?: (messageId: string) => void;
  isTyping?: boolean;
}

export default function ChatWindow({ messages, currentUserId, onMessageRead, isTyping }: ChatWindowProps) {
  return (
    <ScrollArea className="h-full px-4">
      <div className="space-y-2 py-4">
        {messages.map((message, index) => {
          const isOwnMessage = message.senderId === currentUserId;

          return (
            <div
              key={index}
              className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-3 py-2 ${
                  isOwnMessage
                    ? 'bg-[#DCF8C6] text-gray-800'
                    : 'bg-white text-gray-800 shadow-sm'
                }`}
              >
                <p className="text-sm break-words">{message.content}</p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-xs text-gray-500">
                    {format(new Date(message.timestamp), 'HH:mm')}
                  </span>
                  {isOwnMessage && (
                    <span className="text-blue-500">
                      {message.isRead ? (
                        <CheckCheck className="h-4 w-4" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg px-4 py-2 shadow-sm">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }}></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}