declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        close: () => void;
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            username?: string;
            first_name?: string;
            last_name?: string;
            photo_url?: string;
          };
        };
        openTelegramLink: (url: string) => void;
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
  history: { roundId: number; winner: number; pools: { even: number; odd: number } }[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
  onlineCount?: number;
}
