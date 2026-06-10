-- Billable characters (e.g. TTS input text — ElevenLabs bills per character).
ALTER TABLE events ADD COLUMN IF NOT EXISTS characters UInt32 DEFAULT 0 AFTER audio_seconds;
