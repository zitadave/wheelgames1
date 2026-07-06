import cron from "node-cron";
import { gridRooms } from "./GameEngine.js";
import { triggerAnnouncement } from "./announcementManager.js";
import { v4 as uuidv4 } from 'uuid';

export function initScheduler() {
  // Post remaining slots every 12 hours
  cron.schedule("0 */12 * * *", async () => {
    console.log("Running scheduled slot announcements...");
    
    for (const [roomName, room] of Object.entries(gridRooms)) {
      const maxSlots = roomName === '1-10' ? 10 : roomName === '1-20' ? 20 : roomName === 'mini' ? 50 : 100;
      const claimed = Object.keys(room.claimedSlots).map(Number);
      const remaining: number[] = [];
      for (let i = 1; i <= maxSlots; i++) {
        if (!claimed.includes(i)) remaining.push(i);
      }
      
      const displayName = roomName === 'mini' ? 'mini-vip (50 ሰው)' : roomName === 'grand' ? 'vip-grand (100 ሰው)' : roomName === '1-20' ? 'ፈጣን (20 ሰው)' : roomName;
      const announcement = {
        id: uuidv4(),
        type: 'scheduled',
        text: `📢 <b>Remaining Slots Update for ${displayName}</b>\n\nRemaining slots: <code>${remaining.join(', ')}</code>\n\n<i>Book yours now!</i>`,
        status: 'posted' as const
      };
      
      await triggerAnnouncement(announcement);
    }
  });
}
