declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        };
      };
    };
  }
}

export type Side = "even" | "odd";

export interface PlayerBet {
  userId: string;
  username: string;
  amount: number;
  side: Side;
  partial: boolean;
}

export interface RoomState {
  id: string;
  roundId: number;
  status: "betting" | "balancing" | "spinning" | "result";
  timeLeft: number;
  players: Record<string, PlayerBet>;
  pools: { even: number; odd: number };
  feed: string[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
}
