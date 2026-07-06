import * as fs from "fs";
import * as path from "path";
import cron from "node-cron";
import { postToChannel } from "./telegramBot.js";

export interface Announcement {
  id: string;
  type: 'manual' | 'auto_deposit' | 'auto_withdraw' | 'scheduled';
  text: string;
  photoUrl?: string; // Optional screenshot file path or URL
  schedule?: string; // Cron expression
  status: 'pending' | 'approved' | 'posted';
}

const ANNOUNCEMENTS_FILE = path.join(process.cwd(), "announcements.json");

export function loadAnnouncements(): Announcement[] {
  try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load announcements:", e);
  }
  return [];
}

export function saveAnnouncements(announcements: Announcement[]) {
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(announcements, null, 2), "utf-8");
}

export function saveAnnouncement(announcement: Announcement) {
  const announcements = loadAnnouncements();
  announcements.push(announcement);
  saveAnnouncements(announcements);
}

export async function triggerAnnouncement(announcement: Announcement) {
  const options = announcement.photoUrl ? { photo: announcement.photoUrl, caption: announcement.text } : {};
  await postToChannel(announcement.text, options);
  announcement.status = 'posted';
  const announcements = loadAnnouncements();
  const index = announcements.findIndex(a => a.id === announcement.id);
  if (index !== -1) {
    announcements[index] = announcement;
    saveAnnouncements(announcements);
  }
}
