// Copy this file to config.js and fill in your own values. config.js is git-ignored.
// Only use the Supabase *anon/publishable* key here - never the secret key.
// Keys of USERS are Telegram user IDs (the same ones as in bot/users.json).
window.NUTRI_CONFIG = {
  SUPABASE_URL: 'https://your-project-ref.supabase.co',
  SUPABASE_ANON_KEY: 'your-supabase-anon-key',
  // Optional, enables the AI analysis button. Visible to every visitor: use a dedicated key
  // restricted by HTTP referrer in Google AI Studio / Cloud Console, never the bot's key.
  GEMINI_API_KEY: '',
  USERS: {
    '123456789': { nombre: 'Alice', emoji: '💪', cal: 2300, prot: 185, grasas: 75, carb: 220 },
    '987654321': { nombre: 'Bob', emoji: '👩', cal: 1680, prot: 125, grasas: 55, carb: 170 }
  }
};
