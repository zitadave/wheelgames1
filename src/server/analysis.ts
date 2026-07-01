import { supabase } from "./supabase.js";

export async function getAnalysisSummary(timeframe: 'day' | 'week' | 'month' | 'year') {
  const now = new Date();
  let startDate = new Date();
  
  if (timeframe === 'day') startDate.setDate(now.getDate() - 1);
  else if (timeframe === 'week') startDate.setDate(now.getDate() - 7);
  else if (timeframe === 'month') startDate.setMonth(now.getMonth() - 1);
  else if (timeframe === 'year') startDate.setFullYear(now.getFullYear() - 1);

  const { data: txs, error: txError } = await supabase
    .from("transactions")
    .select("amount, type, created_at")
    .gte("created_at", startDate.toISOString());
  
  const { data: logs, error: logError } = await supabase
    .from("game_logs")
    .select("win_amount, game_type, created_at")
    .gte("created_at", startDate.toISOString());

  if (txError || logError) {
    throw new Error("Failed to fetch analysis data");
  }

  let totalDeposits = 0;
  let totalWithdrawals = 0;

  txs?.forEach(tx => {
    if (tx.type === 'deposit') totalDeposits += tx.amount;
    if (tx.type === 'withdrawal') totalWithdrawals += tx.amount;
  });

  const gamesCount: Record<string, number> = {};
  logs?.forEach(log => {
    gamesCount[log.game_type] = (gamesCount[log.game_type] || 0) + 1;
  });

  const totalWinAmount = logs?.reduce((sum, log) => sum + log.win_amount, 0) || 0;

  return {
    totalDeposits,
    totalWithdrawals,
    totalRevenue: totalDeposits - totalWithdrawals, // Simplification
    netProfit: totalDeposits - totalWithdrawals - totalWinAmount,
    gamesCount
  };
}
