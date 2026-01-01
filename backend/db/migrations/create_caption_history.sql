CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS caption_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
    generated_caption TEXT,
    final_caption TEXT,
    feedback_score INT CHECK (
        feedback_score BETWEEN 0 AND 5
    ),
    generated_at TIMESTAMP DEFAULT NOW()
);