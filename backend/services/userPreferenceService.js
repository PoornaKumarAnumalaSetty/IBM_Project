import { query } from '../db/postgres.js';

const DEFAULT_PREFERENCES = {
    preferred_tone: 'casual',
    emoji_level: 2,
    common_phrases: [],
    disliked_phrases: [],
    caption_length_preference: 'medium',
    language_preference: 'en',
    caption_structure: {
        hasEmojisAtEnd: false,
        startsWithQuote: false,
        containsLineBreaks: false,
        firstSentenceLength: 0
    },
    last_updated: null
};

function mergeUniqueLists(existing = [], incoming = [], limit = 10) {
    const set = new Set();
    [...existing, ...incoming].forEach(item => {
        if (item && item.trim().length > 0) {
            set.add(item.trim());
        }
    });
    return Array.from(set).slice(0, limit);
}

export async function getPreferences(userId) {
    if (!userId) {
        return { ...DEFAULT_PREFERENCES };
    }

    const result = await query(
        `
        SELECT
            user_id,
            preferred_tone,
            emoji_level,
            common_phrases,
            disliked_phrases,
            caption_length_preference,
            language_preference,
            caption_structure,
            last_updated
        FROM user_preferences
        WHERE user_id = $1
        `,
        [userId]
    );

    if (result.rows.length === 0) {
        return { ...DEFAULT_PREFERENCES };
    }

    const row = result.rows[0];
    return {
        preferred_tone: row.preferred_tone || DEFAULT_PREFERENCES.preferred_tone,
        emoji_level: row.emoji_level ?? DEFAULT_PREFERENCES.emoji_level,
        common_phrases: row.common_phrases || [],
        disliked_phrases: row.disliked_phrases || [],
        caption_length_preference: row.caption_length_preference || DEFAULT_PREFERENCES.caption_length_preference,
        language_preference: row.language_preference || DEFAULT_PREFERENCES.language_preference,
        caption_structure: row.caption_structure || DEFAULT_PREFERENCES.caption_structure,
        last_updated: row.last_updated
    };
}

export async function updatePreferences(userId, preferenceUpdates = {}) {
    if (!userId) {
        throw new Error('User ID is required to update preferences.');
    }

    const currentPrefs = await getPreferences(userId);

    const nextPrefs = {
        ...currentPrefs,
        ...preferenceUpdates
    };

    nextPrefs.common_phrases = mergeUniqueLists(
        currentPrefs.common_phrases,
        preferenceUpdates.common_phrases
    );

    if (preferenceUpdates.disliked_phrases) {
        nextPrefs.disliked_phrases = mergeUniqueLists(
            currentPrefs.disliked_phrases,
            preferenceUpdates.disliked_phrases
        );
    }

    const values = [
        userId,
        nextPrefs.preferred_tone,
        nextPrefs.emoji_level,
        nextPrefs.common_phrases,
        nextPrefs.disliked_phrases,
        nextPrefs.caption_length_preference,
        nextPrefs.language_preference,
        JSON.stringify(nextPrefs.caption_structure || {})
    ];

    const result = await query(
        `
        INSERT INTO user_preferences (
            user_id,
            preferred_tone,
            emoji_level,
            common_phrases,
            disliked_phrases,
            caption_length_preference,
            language_preference,
            caption_structure,
            last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            preferred_tone = EXCLUDED.preferred_tone,
            emoji_level = EXCLUDED.emoji_level,
            common_phrases = EXCLUDED.common_phrases,
            disliked_phrases = EXCLUDED.disliked_phrases,
            caption_length_preference = EXCLUDED.caption_length_preference,
            language_preference = EXCLUDED.language_preference,
            caption_structure = EXCLUDED.caption_structure,
            last_updated = NOW()
        RETURNING *
        `,
        values
    );

    return {
        preferred_tone: result.rows[0].preferred_tone,
        emoji_level: result.rows[0].emoji_level,
        common_phrases: result.rows[0].common_phrases || [],
        disliked_phrases: result.rows[0].disliked_phrases || [],
        caption_length_preference: result.rows[0].caption_length_preference,
        language_preference: result.rows[0].language_preference || nextPrefs.language_preference,
        caption_structure: result.rows[0].caption_structure || nextPrefs.caption_structure,
        last_updated: result.rows[0].last_updated
    };
}

export async function initPreferences(userId) {
    return updatePreferences(userId, { ...DEFAULT_PREFERENCES });
}

export default {
    getPreferences,
    updatePreferences,
    initPreferences
};

