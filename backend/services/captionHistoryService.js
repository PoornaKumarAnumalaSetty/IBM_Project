import { query } from '../db/postgres.js';

export async function saveEntry({ userId, generatedCaption, finalCaption, feedbackScore = null }) {
    const result = await query(
        `
        INSERT INTO caption_history (
            user_id,
            generated_caption,
            final_caption,
            feedback_score
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, generated_at
        `,
        [userId, generatedCaption, finalCaption, feedbackScore]
    );
    return result.rows[0];
}

export async function getHistoryForUser(userId, limit = 50) {
    const result = await query(
        `
        SELECT id, generated_caption, final_caption, feedback_score, generated_at
        FROM caption_history
        WHERE user_id = $1
        ORDER BY generated_at DESC
        LIMIT $2
        `,
        [userId, limit]
    );
    return result.rows;
}

export default {
    saveEntry,
    getHistoryForUser
};

