import userPreferenceService from './userPreferenceService.js';

const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Emoji}\uFE0F]/gu;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function extractPhrases(text = '') {
    const words = text
        .toLowerCase()
        .match(/\b[a-zA-Z\u00C0-\u017F]{6,}\b/g);

    if (!words) {
        return [];
    }

    const counts = words.reduce((acc, word) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
    }, {});

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word)
        .slice(0, 10);
}

export function detectStructure(text = '') {
    const trimmed = text.trim();
    const firstSentenceMatch = trimmed.match(/[^.!?]+[.!?]?/);
    const firstSentenceLength = firstSentenceMatch ? firstSentenceMatch[0].length : trimmed.length;

    const hasEmojisAtEnd = /[\p{Emoji_Presentation}\p{Emoji}\uFE0F]+$/u.test(trimmed);
    const startsWithQuote = /^["'“”]/.test(trimmed);
    const containsLineBreaks = /\n/.test(text);

    return {
        hasEmojisAtEnd,
        startsWithQuote,
        containsLineBreaks,
        firstSentenceLength
    };
}

export function mergeLists(listA = [], listB = [], limit = 10) {
    const set = new Set();
    [...listA, ...listB].forEach(item => {
        if (item && item.trim().length > 0) {
            set.add(item.trim());
        }
    });
    return Array.from(set).slice(0, limit);
}

function detectTone(text = '') {
    if (!text) return 'casual';
    if (text.includes('!')) return 'energetic';
    if (text.length > 200) return 'detailed';
    return 'casual';
}

function detectLengthPreference(text = '') {
    const length = text.length;
    if (length < 150) return 'short';
    if (length < 250) return 'medium';
    return 'long';
}

function detectEmojiLevel(text = '') {
    const count = (text.match(EMOJI_REGEX) || []).length;
    return clamp(count, 0, 5);
}

export async function learnFromCaption(userId, finalCaption = '', context = {}) {
    if (!userId || !finalCaption) {
        return null;
    }

    const existingPrefs = await userPreferenceService.getPreferences(userId);
    const languagePreference = context.language || existingPrefs.language_preference;

    const detectedEmoji = detectEmojiLevel(finalCaption);
    const newEmojiLevel = existingPrefs.emoji_level !== undefined
        ? (existingPrefs.emoji_level + detectedEmoji) / 2
        : detectedEmoji;

    const detectedTone = detectTone(finalCaption);
    const extractedPhrases = extractPhrases(finalCaption);
    const structure = detectStructure(finalCaption);
    const lengthPreference = detectLengthPreference(finalCaption);

    return {
        preferred_tone: detectedTone || existingPrefs.preferred_tone,
        emoji_level: Number(newEmojiLevel.toFixed(2)),
        common_phrases: mergeLists(existingPrefs.common_phrases, extractedPhrases),
        caption_structure: structure,
        caption_length_preference: lengthPreference,
        language_preference: languagePreference || existingPrefs.language_preference
    };
}

export default {
    learnFromCaption,
    extractPhrases,
    detectStructure,
    mergeLists
};

