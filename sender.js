import "dotenv/config";
import nodemailer from "nodemailer";
import { messge } from "./messgeHtml.js";

// Placeholder for customerEmails, you need to define or load this array

const customerEmails = [
  "mutuelleesante@gmail.com"
]

// Precise Gmail limits for 100 emails per hour
const GMAIL_LIMITS = {
  HOURLY_LIMIT: 100,
  EMAILS_PER_BATCH: 10,
  MIN_DELAY: 2000,
  BATCH_DELAY: 5000,
  HOURLY_RESET_TIME: 3600000,
  SAFETY_BUFFER: 5,
};

// Function to format time in HH:MM:SS
function formatTime(milliseconds) {
  const seconds = Math.floor((milliseconds / 1000) % 60);
  const minutes = Math.floor((milliseconds / (1000 * 60)) % 60);
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// New countdown function
async function countdown(milliseconds, message) {
  const startTime = Date.now();
  const endTime = startTime + milliseconds;

  while (Date.now() < endTime) {
    const remaining = endTime - Date.now();
    const percent = ((milliseconds - remaining) / milliseconds) * 100;
    const barLength = 30;
    const filledLength = Math.round((barLength * percent) / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    process.stdout.write(`\r${message} [${bar}] ${formatTime(remaining)} remaining`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Update every second
  }
  console.log('\n'); // New line after countdown completes
}

// Progress bar function
function updateProgressBar(current, total, emailsSent) {
  const timePercent = Math.round((current / total) * 100);
  const timeFilledLength = Math.round(50 * current / total);
  const timeBar = '█'.repeat(timeFilledLength) + '░'.repeat(50 - timeFilledLength);

  const emailPercent = Math.round((emailsSent / total) * 100);
  const emailFilledLength = Math.round(50 * emailsSent / total);
  const emailBar = '█'.repeat(emailFilledLength) + '░'.repeat(50 - emailFilledLength);

  process.stdout.write(`\r[Time: ${timeBar}] ${timePercent}% | Progress: ${current}/${total}\n`);
  process.stdout.write(`[Emails: ${emailBar}] ${emailPercent}% | Sent: ${emailsSent}/${total}`);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  pool: true,
  maxConnections: 1,
  rateDelta: 1000,
  rateLimit: 1,
  maxMessages: GMAIL_LIMITS.HOURLY_LIMIT - GMAIL_LIMITS.SAFETY_BUFFER,
});

class EmailTracker {
  constructor() {
    this.sentEmails = [];
    this.currentHourStart = Date.now();
    this.lastSendTime = null;
  }

  recordSend() {
    const now = Date.now();
    this.sentEmails.push(now);
    this.lastSendTime = now;
    this.cleanup();
  }

  cleanup() {
    const hourAgo = Date.now() - GMAIL_LIMITS.HOURLY_RESET_TIME;
    this.sentEmails = this.sentEmails.filter(time => time > hourAgo);
  }

  getCurrentHourCount() {
    this.cleanup();
    return this.sentEmails.length;
  }

  canSendMore() {
    const currentCount = this.getCurrentHourCount();
    return currentCount < (GMAIL_LIMITS.HOURLY_LIMIT - GMAIL_LIMITS.SAFETY_BUFFER);
  }

  getTimeUntilNextSlot() {
    if (this.sentEmails.length === 0) return 0;
    const oldestTimestamp = this.sentEmails[0];
    return (oldestTimestamp + GMAIL_LIMITS.HOURLY_RESET_TIME) - Date.now();
  }

  getMinimumWaitTime() {
    if (!this.lastSendTime) return 0;
    const timeSinceLastSend = Date.now() - this.lastSendTime;
    return Math.max(0, GMAIL_LIMITS.MIN_DELAY - timeSinceLastSend);
  }
}

const emailTracker = new EmailTracker();

async function sendEmail(email) {
  try {
    await transporter.verify();

    const info = await transporter.sendMail({
      from: {
        name: "Ahmed Foullane",
        address: process.env.EMAIL_USER,
      },
      to: email,
      subject: "Candidature au poste de Stagiaire Développeur",
      html: messge,
      headers: {
        'Precedence': 'bulk',
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER}?subject=unsubscribe>`,
        'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      },
      attachments: [
        {
          filename: "CV_Ahmed_Foullane.pdf",
          path: "Foullane.Ahmed.pdf", // update path as needed
          contentType: "application/pdf"
        }
      ]
    });

    emailTracker.recordSend();
    return { success: true, info };
  } catch (error) {
    if (error.responseCode === 421 || error.responseCode === 450 || 
        error.message.includes('rate') || error.message.includes('limit')) {
      throw new Error(`Rate limit reached: ${error.message}`);
    }
    throw error;
  }
}

async function sendEmails() {
  console.log("\n🚀 Starting email campaign with countdown timers...\n");

  const stats = {
    total: customerEmails.length,
    sent: 0,
    failed: 0,
    rateLimit: 0,
    startTime: Date.now()
  };

  let totalEmailsSent = 0; // Initialize this variable

  for (let i = 0; i < customerEmails.length; i += GMAIL_LIMITS.EMAILS_PER_BATCH) {
    const batch = customerEmails.slice(i, i + GMAIL_LIMITS.EMAILS_PER_BATCH);
    
    for (const email of batch) {
      try {
        await sendEmail(email);
        stats.sent++;
        updateProgressBar(i + batch.indexOf(email) + 1, stats.total, stats.sent);
      } catch (error) {
        if (error.message.includes('Rate limit')) {
          stats.rateLimit++;
          const waitTimeMs = 65 * 60 * 1000; // 65 minutes
          console.log('\n🚫 Rate limit hit. Waiting with countdown...');
          await countdown(waitTimeMs, '⏳ Rate limit cooldown');
          
          // Try sending this email again after waiting
          try {
            await sendEmail(email);
            stats.sent++;
            updateProgressBar(i + batch.indexOf(email) + 1, stats.total, stats.sent);
            console.log('✨ Successfully resumed sending after rate limit wait!');
          } catch (retryError) {
            stats.failed++;
            console.error(`❌ Error sending to ${email} after waiting: ${retryError.message}`);
          }
        } else {
          stats.failed++;
          console.error(`\n❌ Error sending to ${email}: ${error.message}`);
        }
        updateProgressBar(i + batch.indexOf(email) + 1, stats.total, stats.sent);
      }

      // Add small delay between individual emails
      await countdown(GMAIL_LIMITS.MIN_DELAY, '⏱️ Next email in');
    }

    if (i + GMAIL_LIMITS.EMAILS_PER_BATCH < customerEmails.length) {
      console.log('\n⏳ Starting batch cooldown...');
      await countdown(GMAIL_LIMITS.BATCH_DELAY, '⏳ Batch cooldown');
    }
  }

  // Final summary
  const duration = (Date.now() - stats.startTime) / 60000;
  console.log("\n📊 Campaign Summary:");
  console.log(`⏱️  Duration: ${Math.round(duration)} minutes`);
 
  console.log(`📧 Sent successfully: ${stats.sent}/${stats.total}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`🚫 Rate limits hit: ${stats.rateLimit}`);
  console.log(`✨ Success rate: ${((stats.sent / stats.total) * 100).toFixed(1)}%\n`);
}

// Error handling wrapper
sendEmails().catch(error => {
  console.error("\n💥 Campaign failed:", error);
  process.exit(1);
});
