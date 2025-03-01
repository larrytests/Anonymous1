import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Optional: Utility function for voice call status classes
export function getCallStatusClass(status: 'idle' | 'requesting' | 'incoming' | 'connected' | 'ended' | 'rejected' | 'busy'): string {
  switch (status) {
    case 'idle':
      return 'bg-gray-100 text-gray-700';
    case 'requesting':
      return 'bg-yellow-100 text-yellow-700 animate-pulse';
    case 'incoming':
      return 'bg-blue-100 text-blue-700 animate-pulse';
    case 'connected':
      return 'bg-green-100 text-green-700';
    case 'ended':
    case 'rejected':
    case 'busy':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}