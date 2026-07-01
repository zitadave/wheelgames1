import { supabase } from './supabase.js';

/**
 * 1-10 Room (500 ETB Ticket Entry)
 * 10 spots -> 1st: 4000 ETB, 2nd: 500 ETB
 */
export async function handleRoom10(roomId: string) {
  // Generate random winners
  const pool = Array.from({ length: 10 }, (_, i) => i + 1);
  const firstIndex = Math.floor(Math.random() * pool.length);
  const firstWinner = pool.splice(firstIndex, 1)[0];
  
  const secondIndex = Math.floor(Math.random() * pool.length);
  const secondWinner = pool.splice(secondIndex, 1)[0];

  return { firstWinner, secondWinner, payouts: { first: 4000, second: 500 } };
}

/**
 * 1-20 Room (1,000 ETB Ticket Entry)
 * 20 spots -> 1st: 14000 ETB, 2nd: 3000 ETB, 3rd: 1000 ETB
 */
export async function handleRoom20(roomId: string) {
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  const getWinner = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  
  return {
    firstWinner: getWinner(),
    secondWinner: getWinner(),
    thirdWinner: getWinner(),
    payouts: { first: 14000, second: 3000, third: 1000 }
  };
}

/**
 * Buy Ticket - Uses PostgreSQL explicit row-level locking (SELECT FOR UPDATE)
 * Must be executed via Supabase RPC in production.
 */
export async function buyTicket(userId: string, roomId: string, seatIndex: number, amount: number) {
  // Mock representation of the SQL transaction required
  try {
    // In a real implementation this would call an RPC function like:
    // const { data, error } = await supabase.rpc('purchase_ticket', { p_user_id: userId, p_room_id: roomId, p_seat_index: seatIndex, p_amount: amount });
    return { success: true, message: `Ticket ${seatIndex} purchased successfully.` };
  } catch (error) {
    return { success: false, error: 'Transaction failed' };
  }
}
