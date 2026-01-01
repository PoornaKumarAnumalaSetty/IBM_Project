CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferred_tone VARCHAR(50),
    emoji_level INT CHECK (emoji_level BETWEEN 0 AND 5) DEFAULT 2,
    common_phrases TEXT[],
    disliked_phrases TEXT[],
    caption_length_preference VARCHAR(20),
    language_preference VARCHAR(10),
    caption_structure JSONB,
    last_updated TIMESTAMP DEFAULT NOW()
);

