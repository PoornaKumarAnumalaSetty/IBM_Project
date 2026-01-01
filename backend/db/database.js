import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const dbConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const pool = new Pool(dbConfig);

pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err);
    process.exit(-1);
});

async function initializeDatabase() {
    const client = await pool.connect();

    try {
        // Users table - ADDING brand_voice AND target_audience COLUMNS
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                is_verified BOOLEAN DEFAULT FALSE,
                otp_code VARCHAR(10),
                otp_expires TIMESTAMP,
                brand_voice VARCHAR(100),       -- NEW COLUMN: User's preferred brand voice (e.g., 'witty', 'professional')
                target_audience VARCHAR(255),   -- NEW COLUMN: User's target audience description
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add columns if they don't exist (for existing databases)
        await client.query(`
            DO $$ BEGIN
                ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_voice VARCHAR(100);
                ALTER TABLE users ADD COLUMN IF NOT EXISTS target_audience VARCHAR(255);
            END $$;
        `);

        // UPDATED: saved_posts table with new 'language' column
        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_posts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                topic VARCHAR(255) NOT NULL,
                caption TEXT NOT NULL,
                hashtags TEXT[] NOT NULL,
                mood VARCHAR(100) NOT NULL,
                persona VARCHAR(100) NOT NULL,
                trending_topic VARCHAR(255),
                language VARCHAR(100) NOT NULL, -- NEW COLUMN: for multi-language support
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Calendar Events table (unchanged)
        await client.query(`
            CREATE TABLE IF NOT EXISTS calendar_events (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                post_id INTEGER REFERENCES saved_posts(id) ON DELETE CASCADE,
                scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, post_id, scheduled_date)
            )
        `);

        // share_links table (unchanged)
        await client.query(`
            CREATE TABLE IF NOT EXISTS share_links (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                share_token VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);

        // NEW TABLES FOR REWRITTEN CAPTIONS
        await client.query(`
            CREATE TABLE IF NOT EXISTS rewritten_sets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                original_caption TEXT NOT NULL,
                mood VARCHAR(100) NOT NULL,
                length VARCHAR(100) NOT NULL,
                language VARCHAR(100) NOT NULL,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS rewritten_suggestions (
                id SERIAL PRIMARY KEY, 
                rewritten_set_id INTEGER REFERENCES rewritten_sets(id) ON DELETE CASCADE,
                caption_text TEXT NOT NULL,
                suggestion_order INTEGER NOT NULL 
            )
        `);

        // ========== ADVANCED BRAND VOICE ENGINE TABLES ==========
        
        // Voice Profiles table - stores multidimensional voice vectors
        await client.query(`
            CREATE TABLE IF NOT EXISTS voice_profiles (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
                profile_name VARCHAR(100) NOT NULL DEFAULT 'Default Profile',
                formality DECIMAL(3,2) DEFAULT 0.5,        -- 0=casual, 1=formal
                humor DECIMAL(3,2) DEFAULT 0.5,            -- 0=serious, 1=humorous
                enthusiasm DECIMAL(3,2) DEFAULT 0.5,       -- 0=neutral, 1=enthusiastic
                professionalism DECIMAL(3,2) DEFAULT 0.5,  -- 0=personal, 1=professional
                creativity DECIMAL(3,2) DEFAULT 0.5,       -- 0=straightforward, 1=creative
                emotional_tone DECIMAL(3,2) DEFAULT 0.5,   -- 0=rational, 1=emotional
                confidence DECIMAL(3,2) DEFAULT 0.5,       -- 0=tentative, 1=confident
                warmth DECIMAL(3,2) DEFAULT 0.5,           -- 0=cold, 1=warm
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Content Analysis table - stores ML analysis of user content for training
        await client.query(`
            CREATE TABLE IF NOT EXISTS content_analysis (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                content_type VARCHAR(50) NOT NULL, -- 'caption', 'hashtag', 'rewritten_caption'
                content_id INTEGER, -- Reference to saved_posts.id or rewritten_sets.id
                content_text TEXT NOT NULL,
                analyzed_formality DECIMAL(3,2),
                analyzed_humor DECIMAL(3,2),
                analyzed_enthusiasm DECIMAL(3,2),
                analyzed_professionalism DECIMAL(3,2),
                analyzed_creativity DECIMAL(3,2),
                analyzed_emotional_tone DECIMAL(3,2),
                analyzed_confidence DECIMAL(3,2),
                analyzed_warmth DECIMAL(3,2),
                analysis_confidence DECIMAL(3,2) DEFAULT 0.0,
                analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Voice Feedback table - stores user feedback for learning system
        await client.query(`
            CREATE TABLE IF NOT EXISTS voice_feedback (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                generated_content_id INTEGER, -- Reference to the content that was generated
                content_type VARCHAR(50) NOT NULL, -- 'caption', 'hashtag', 'rewritten_caption'
                feedback_type VARCHAR(20) NOT NULL, -- 'positive', 'negative', 'neutral'
                feedback_comment TEXT,
                expected_formality DECIMAL(3,2),
                expected_humor DECIMAL(3,2),
                expected_enthusiasm DECIMAL(3,2),
                expected_professionalism DECIMAL(3,2),
                expected_creativity DECIMAL(3,2),
                expected_emotional_tone DECIMAL(3,2),
                expected_confidence DECIMAL(3,2),
                expected_warmth DECIMAL(3,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Voice Training Sessions table - tracks ML training progress
        await client.query(`
            CREATE TABLE IF NOT EXISTS voice_training_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                training_type VARCHAR(50) NOT NULL, -- 'initial', 'refinement', 'feedback_based'
                samples_used INTEGER DEFAULT 0,
                accuracy_score DECIMAL(4,3) DEFAULT 0.0, -- 0-1 scale
                training_duration INTEGER, -- in seconds
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ========== INDEXES ==========
        
        // Existing indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_saved_posts_user_id ON saved_posts(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_calendar_events_scheduled_date ON calendar_events(scheduled_date);`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token ON share_links(share_token);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_share_links_user_id ON share_links(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_rewritten_sets_user_id ON rewritten_sets(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_rewritten_suggestions_set_id ON rewritten_suggestions(rewritten_set_id);`);

        // New indexes for Advanced Brand Voice Engine
        await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_profiles_active ON voice_profiles(user_id) WHERE is_active = TRUE;`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_content_analysis_user_id ON content_analysis(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_content_analysis_type ON content_analysis(content_type);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_feedback_user_id ON voice_feedback(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_feedback_type ON voice_feedback(feedback_type);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_voice_training_user_id ON voice_training_sessions(user_id);`);

        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    } finally {
        client.release();
    }
}

class Database {
    async createUser(username, email, passwordHash) {
        const query = `
            INSERT INTO users (username, email, password_hash)
            VALUES ($1, $2, $3)
            RETURNING id, username, email, created_at, is_verified
        `;
        const result = await pool.query(query, [username, email, passwordHash]);
        return result.rows[0];
    }

    async getUserByEmail(email) {
        const query = 'SELECT * FROM users WHERE email = $1';
        const result = await pool.query(query, [email]);
        return result.rows[0];
    }

    async getUserById(id) {
        // UPDATED: Include brand_voice and target_audience in SELECT
        const query = 'SELECT id, username, email, created_at, is_verified, brand_voice, target_audience FROM users WHERE id = $1';
        const result = await pool.query(query, [id]);
        return result.rows[0];
    }

    async setOtpCode(userId, otpCode, expires) {
        const query = `
            UPDATE users SET otp_code = $1, otp_expires = $2 WHERE id = $3 RETURNING id, email;
        `;
        const result = await pool.query(query, [otpCode, expires, userId]);
        return result.rows[0];
    }

    async getUserByOtpCode(email, otpCode) {
        const query = 'SELECT * FROM users WHERE email = $1 AND otp_code = $2 AND otp_expires > NOW()';
        const result = await pool.query(query, [email, otpCode]);
        return result.rows[0];
    }

    async markUserAsVerified(userId) {
        const query = `
            UPDATE users SET is_verified = TRUE, otp_code = NULL, otp_expires = NULL WHERE id = $1 RETURNING id, email, is_verified;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    }

    /**
     * Updates a user's profile information, including brand voice and target audience.
     * @param {number} userId - The ID of the user to update.
     * @param {object} updates - An object containing fields to update (e.g., { brandVoice: 'witty', targetAudience: 'Gen Z' }).
     * @returns {Promise<object>} The updated user record.
     */
    async updateUserProfile(userId, updates) {
        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        if (updates.brandVoice !== undefined) {
            setClauses.push(`brand_voice = $${paramIndex++}`);
            values.push(updates.brandVoice);
        }
        if (updates.targetAudience !== undefined) {
            setClauses.push(`target_audience = $${paramIndex++}`);
            values.push(updates.targetAudience);
        }
        // Add more fields here if you want to allow updating them via this method
        // e.g., if (updates.username) { setClauses.push(`username = $${paramIndex++}`); values.push(updates.username); }

        if (setClauses.length === 0) {
            return this.getUserById(userId); // Nothing to update, just return current user
        }

        values.push(userId); // Add userId as the last parameter

        const query = `
            UPDATE users
            SET ${setClauses.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, username, email, is_verified, brand_voice, target_audience, created_at;
        `;
        console.log('Database: updateUserProfile query:', query, 'values:', values);
        const result = await pool.query(query, values);
        return result.rows[0];
    }

    // UPDATED: savePost to include 'language'
    async savePost(userId, postData) {
        console.log('Database: savePost called with postData:', postData);
        const query = `
            INSERT INTO saved_posts (user_id, topic, caption, hashtags, mood, persona, trending_topic, language)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        const result = await pool.query(query, [
            userId,
            postData.topic,
            postData.caption,
            postData.hashtags,
            postData.mood,
            postData.persona,
            postData.trendingTopic,
            postData.language
        ]);
        console.log('Database: savePost successfully inserted post ID:', result.rows[0].id);
        return result.rows[0];
    }

    /**
     * Saves a set of rewritten captions to the database.
     * @param {number} userId - The ID of the user generating the captions.
     * @param {object} metadata - Contains original_caption, mood, length, language.
     * @param {string[]} captions - An array of the rewritten caption strings.
     * @returns {Promise<object>} The newly created rewritten set record.
     */
    async saveRewrittenCaptions(userId, metadata, captions) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); // Start transaction

            // 1. Insert into rewritten_sets table
            const setQuery = `
                INSERT INTO rewritten_sets (user_id, original_caption, mood, length, language)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, generated_at;
            `;
            const setResult = await client.query(setQuery, [
                userId,
                metadata.originalCaption,
                metadata.mood,
                metadata.length,
                metadata.language
            ]);
            const rewrittenSet = setResult.rows[0];
            const rewrittenSetId = rewrittenSet.id;

            // 2. Insert each rewritten caption into rewritten_suggestions table
            const suggestionQuery = `
                INSERT INTO rewritten_suggestions (rewritten_set_id, caption_text, suggestion_order)
                VALUES ($1, $2, $3);
            `;
            for (let i = 0; i < captions.length; i++) {
                await client.query(suggestionQuery, [rewrittenSetId, captions[i], i + 1]);
            }

            await client.query('COMMIT'); // Commit transaction
            console.log(`Database: Successfully saved rewritten set ID ${rewrittenSetId} with ${captions.length} suggestions.`);
            return rewrittenSet;
        } catch (error) {
            await client.query('ROLLBACK'); // Rollback on error
            console.error('Database: Error saving rewritten captions:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Retrieves all saved rewritten caption sets for a user, including their suggestions.
     * @param {number} userId - The ID of the user.
     * @returns {Promise<Array<object>>} An array of rewritten sets, each with a 'suggestions' array.
     */
    async getRewrittenCaptionSets(userId) {
        console.log('Database: getRewrittenCaptionSets called for userId:', userId);
        const query = `
            SELECT
                rs.id AS set_id,
                rs.original_caption,
                rs.mood,
                rs.length,
                rs.language,
                rs.generated_at,
                json_agg(json_build_object('id', rsg.id, 'caption_text', rsg.caption_text, 'suggestion_order', rsg.suggestion_order) ORDER BY rsg.suggestion_order) AS suggestions
            FROM
                rewritten_sets rs
            JOIN
                rewritten_suggestions rsg ON rs.id = rsg.rewritten_set_id
            WHERE
                rs.user_id = $1
            GROUP BY
                rs.id
            ORDER BY
                rs.generated_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        console.log('Database: getRewrittenCaptionSets returned', result.rows.length, 'sets.');
        return result.rows;
    }

    /**
     * Deletes a rewritten caption set and its associated suggestions.
     * @param {number} setId - The ID of the rewritten set to delete.
     * @param {number} userId - The ID of the user who owns the set (for security).
     * @returns {Promise<object>} The deleted rewritten set record, or null if not found/deleted.
     */
    async deleteRewrittenSet(setId, userId) {
        console.log(`Database: Deleting rewritten set ID ${setId} for user ${userId}.`);
        const query = 'DELETE FROM rewritten_sets WHERE id = $1 AND user_id = $2 RETURNING *;';
        const result = await pool.query(query, [setId, userId]);
        return result.rows[0]; // Returns the deleted row if successful, undefined otherwise
    }

    // UPDATED: getSavedPosts to include 'language' in SELECT
    async getSavedPosts(userId, limit = null) {
        console.log('Database: getSavedPosts called for userId:', userId);
        let query = `
            SELECT id, user_id, topic, caption, hashtags, mood, persona, trending_topic, language, created_at
            FROM saved_posts 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `;
        const params = [userId];

        if (limit) {
            query += ' LIMIT $2';
            params.push(limit);
        }

        const result = await pool.query(query, params);
        console.log('Database: getSavedPosts returned', result.rows.length, 'rows.');
        return result.rows;
    }

    // UPDATED: getSavedPostById to include 'language' in SELECT
    async getSavedPostById(postId, userId) {
        console.log('Database: getSavedPostById called for postId:', postId, 'userId:', userId);
        const query = 'SELECT id, user_id, topic, caption, hashtags, mood, persona, trending_topic, language, created_at FROM saved_posts WHERE id = $1 AND user_id = $2';
        const result = await pool.query(query, [postId, userId]);
        console.log('Database: getSavedPostById returned', result.rows.length, 'row.');
        return result.rows[0];
    }

    async deleteSavedPost(postId, userId) {
        const query = 'DELETE FROM saved_posts WHERE id = $1 AND user_id = $2 RETURNING *';
        const result = await pool.query(query, [postId, userId]);
        return result.rows[0];
    }

    async schedulePost(userId, postId, scheduledDate) {
        console.log('Database: schedulePost called for postId:', postId, 'scheduledDate:', scheduledDate);
        const query = `
            INSERT INTO calendar_events (user_id, post_id, scheduled_date)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [userId, postId, scheduledDate]);
        console.log('Database: schedulePost successfully inserted event ID:', result.rows[0].id);
        return result.rows[0];
    }

    async getScheduledPosts(userId) {
        console.log('Database: getScheduledPosts called for userId:', userId);
        const query = `
            SELECT ce.*, sp.topic, sp.caption, sp.hashtags, sp.mood, sp.persona, sp.trending_topic, sp.language, u.username as owner_username
            FROM calendar_events ce
            JOIN saved_posts sp ON ce.post_id = sp.id
            JOIN users u ON ce.user_id = u.id
            WHERE ce.user_id = $1
            ORDER BY ce.scheduled_date ASC
        `;
        const result = await pool.query(query, [userId]);
        console.log('Database: getScheduledPosts returned', result.rows.length, 'rows.');
        return result.rows;
    }

    async unschedulePost(eventId, userId) {
        const query = 'DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 RETURNING *';
        const result = await pool.query(query, [eventId, userId]);
        return result.rows[0];
    }

    async getUserStats(userId) {
        console.log('Database: getUserStats called for userId:', userId, ' (Enhanced version)');
        const client = await pool.connect();
        try {
            const [
                totalSavedResult,
                totalScheduledResult,
                moodBreakdownResult,
                personaBreakdownResult,
                topHashtagsResult,
                totalRewrittenResult
            ] = await Promise.all([
                client.query('SELECT COUNT(*) as count FROM saved_posts WHERE user_id = $1', [userId]),
                client.query('SELECT COUNT(*) as count FROM calendar_events WHERE user_id = $1', [userId]),
                client.query('SELECT mood, COUNT(*) as count FROM saved_posts WHERE user_id = $1 GROUP BY mood ORDER BY count DESC', [userId]),
                client.query('SELECT persona, COUNT(*) as count FROM saved_posts WHERE user_id = $1 GROUP BY persona ORDER BY count DESC', [userId]),
                client.query(`
                    SELECT unnest(hashtags) as hashtag, COUNT(*) as count
                    FROM saved_posts
                    WHERE user_id = $1
                    GROUP BY hashtag
                    ORDER BY count DESC
                    LIMIT 10
                `, [userId]),
                client.query('SELECT COUNT(*) as count FROM rewritten_sets WHERE user_id = $1', [userId])
            ]);

            const totalSaved = parseInt(totalSavedResult.rows[0].count) || 0;
            const totalScheduled = parseInt(totalScheduledResult.rows[0].count) || 0;
            const moodBreakdown = moodBreakdownResult.rows.map(row => ({ mood: row.mood, count: parseInt(row.count) }));
            const personaBreakdown = personaBreakdownResult.rows.map(row => ({ persona: row.persona, count: parseInt(row.count) }));
            const topHashtags = topHashtagsResult.rows.map(row => ({ hashtag: row.hashtag, count: parseInt(row.count) }));
            const totalRewritten = parseInt(totalRewrittenResult.rows[0].count) || 0;

            console.log('Database: getUserStats results:', { totalSaved, totalScheduled, moodBreakdown, personaBreakdown, topHashtags, totalRewritten });
            
            return {
                totalGenerated: totalSaved + totalRewritten,
                totalSaved: totalSaved,
                totalScheduled: totalScheduled,
                totalRewritten: totalRewritten,
                moodBreakdown: moodBreakdown,
                personaBreakdown: personaBreakdown,
                topHashtags: topHashtags
            };
        } catch (error) {
            console.error('Database: Error in getUserStats:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async createShareLink(userId, shareToken, expiresAt = null) {
        const query = `
            INSERT INTO share_links (user_id, share_token, expires_at)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [userId, shareToken, expiresAt]);
        return result.rows[0];
    }

    async getShareLinkByToken(shareToken) {
        const query = `
            SELECT sl.*, u.username as owner_username, u.email as owner_email
            FROM share_links sl
            JOIN users u ON sl.user_id = u.id
            WHERE sl.share_token = $1 AND sl.is_active = TRUE AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
        `;
        const result = await pool.query(query, [shareToken]);
        return result.rows[0];
    }

    async getShareLinksByUserId(userId) {
        const query = `
            SELECT * FROM share_links WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    }

    async deleteShareLink(shareLinkId, userId) {
        const query = `
            UPDATE share_links SET is_active = FALSE WHERE id = $1 AND user_id = $2 RETURNING *;
        `;
        const result = await pool.query(query, [shareLinkId, userId]);
        return result.rows[0];
    }

    // ========== ADVANCED BRAND VOICE ENGINE METHODS ==========

    /**
     * Creates or updates a voice profile for a user
     * @param {number} userId - The user ID
     * @param {object} voiceData - Voice vector data
     * @returns {Promise<object>} The created/updated voice profile
     */
    async upsertVoiceProfile(userId, voiceData) {
        const query = `
            INSERT INTO voice_profiles (
                user_id, profile_name, formality, humor, enthusiasm, 
                professionalism, creativity, emotional_tone, confidence, warmth
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                profile_name = EXCLUDED.profile_name,
                formality = EXCLUDED.formality,
                humor = EXCLUDED.humor,
                enthusiasm = EXCLUDED.enthusiasm,
                professionalism = EXCLUDED.professionalism,
                creativity = EXCLUDED.creativity,
                emotional_tone = EXCLUDED.emotional_tone,
                confidence = EXCLUDED.confidence,
                warmth = EXCLUDED.warmth,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        
        const values = [
            userId,
            voiceData.profileName || 'Default Profile',
            voiceData.formality || 0.5,
            voiceData.humor || 0.5,
            voiceData.enthusiasm || 0.5,
            voiceData.professionalism || 0.5,
            voiceData.creativity || 0.5,
            voiceData.emotionalTone || 0.5,
            voiceData.confidence || 0.5,
            voiceData.warmth || 0.5
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Gets the active voice profile for a user
     * @param {number} userId - The user ID
     * @returns {Promise<object>} The active voice profile
     */
    async getVoiceProfile(userId) {
        const query = `
            SELECT * FROM voice_profiles 
            WHERE user_id = $1 AND is_active = TRUE
            ORDER BY updated_at DESC 
            LIMIT 1
        `;
        const result = await pool.query(query, [userId]);
        return result.rows[0];
    }

    /**
     * Stores content analysis results for ML training
     * @param {number} userId - The user ID
     * @param {object} analysisData - Analysis results
     * @returns {Promise<object>} The stored analysis record
     */
    async storeContentAnalysis(userId, analysisData) {
        const query = `
            INSERT INTO content_analysis (
                user_id, content_type, content_id, content_text,
                analyzed_formality, analyzed_humor, analyzed_enthusiasm,
                analyzed_professionalism, analyzed_creativity, analyzed_emotional_tone,
                analyzed_confidence, analyzed_warmth, analysis_confidence
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;
        
        const values = [
            userId,
            analysisData.contentType,
            analysisData.contentId || null,
            analysisData.contentText,
            analysisData.formality,
            analysisData.humor,
            analysisData.enthusiasm,
            analysisData.professionalism,
            analysisData.creativity,
            analysisData.emotionalTone,
            analysisData.confidence,
            analysisData.warmth,
            analysisData.confidence || 0.0
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Stores user feedback for voice profile learning
     * @param {number} userId - The user ID
     * @param {object} feedbackData - Feedback data
     * @returns {Promise<object>} The stored feedback record
     */
    async storeVoiceFeedback(userId, feedbackData) {
        const query = `
            INSERT INTO voice_feedback (
                user_id, generated_content_id, content_type, feedback_type,
                feedback_comment, expected_formality, expected_humor,
                expected_enthusiasm, expected_professionalism, expected_creativity,
                expected_emotional_tone, expected_confidence, expected_warmth
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;
        
        const values = [
            userId,
            feedbackData.generatedContentId || null,
            feedbackData.contentType,
            feedbackData.feedbackType,
            feedbackData.feedbackComment || null,
            feedbackData.expectedFormality || null,
            feedbackData.expectedHumor || null,
            feedbackData.expectedEnthusiasm || null,
            feedbackData.expectedProfessionalism || null,
            feedbackData.expectedCreativity || null,
            feedbackData.expectedEmotionalTone || null,
            feedbackData.expectedConfidence || null,
            feedbackData.expectedWarmth || null
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    /**
     * Gets content analysis history for a user (for ML training)
     * @param {number} userId - The user ID
     * @param {number} limit - Number of records to return
     * @returns {Promise<Array>} Array of analysis records
     */
    async getContentAnalysisHistory(userId, limit = 100) {
        const query = `
            SELECT * FROM content_analysis 
            WHERE user_id = $1 
            ORDER BY analyzed_at DESC 
            LIMIT $2
        `;
        const result = await pool.query(query, [userId, limit]);
        return result.rows;
    }

    /**
     * Gets voice feedback history for a user
     * @param {number} userId - The user ID
     * @param {number} limit - Number of records to return
     * @returns {Promise<Array>} Array of feedback records
     */
    async getVoiceFeedbackHistory(userId, limit = 50) {
        const query = `
            SELECT * FROM voice_feedback 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2
        `;
        const result = await pool.query(query, [userId, limit]);
        return result.rows;
    }

    /**
     * Records a voice training session
     * @param {number} userId - The user ID
     * @param {object} trainingData - Training session data
     * @returns {Promise<object>} The recorded training session
     */
    async recordTrainingSession(userId, trainingData) {
        const query = `
            INSERT INTO voice_training_sessions (
                user_id, training_type, samples_used, accuracy_score, training_duration
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        
        const values = [
            userId,
            trainingData.trainingType,
            trainingData.samplesUsed || 0,
            trainingData.accuracyScore || 0.0,
            trainingData.trainingDuration || 0
        ];

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    async close() {
        await pool.end();
    }
}

if (process.env.DATABASE_URL) {
    initializeDatabase().catch(console.error);
} else {
    console.warn('⚠️ DATABASE_URL not provided. Database operations will fail.');
}

export default new Database();
export { pool };