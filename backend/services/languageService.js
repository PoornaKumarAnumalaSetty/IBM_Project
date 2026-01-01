import { franc } from 'franc-min';
import database from '../db/database.js';

const FRANC_TO_ISO = {
    eng: 'en',
    hin: 'hi',
    tel: 'te',
    tam: 'ta',
    kan: 'kn',
    mal: 'ml',
    ben: 'bn',
    mar: 'mr',
    pan: 'pa',
    guj: 'gu',
    urd: 'ur',
    spa: 'es',
    deu: 'de',
    fra: 'fr'
};

const LANGUAGE_LABELS = {
    en: 'English',
    hi: 'Hindi',
    te: 'Telugu',
    ta: 'Tamil',
    kn: 'Kannada',
    ml: 'Malayalam',
    bn: 'Bengali',
    mr: 'Marathi',
    pa: 'Punjabi',
    gu: 'Gujarati',
    ur: 'Urdu',
    es: 'Spanish',
    de: 'German',
    fr: 'French'
};

const DEFAULT_LANGUAGE = 'en';

function mapFrancToIso(code) {
    if (!code || code === 'und') { return null; }
    return FRANC_TO_ISO[code] || null;
}

function sanitizeText(text) {
    return text
        .replace(/[#@][\w-]+/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function detectLanguageFromCaption(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }

    const cleaned = sanitizeText(text);

    if (cleaned.length < 3) { return null; }

    const francCode = franc(cleaned, { whitelist: Object.keys(FRANC_TO_ISO) });
    const isoCode = mapFrancToIso(francCode);

    if (!isoCode) { return null; }

    return {
        isoCode,
        label: LANGUAGE_LABELS[isoCode] || isoCode,
        raw: francCode
    };
}

export async function detectLanguageDistributionForUser(userId, limit = 50) {
    if (!userId) { return null; }

    const posts = await database.getSavedPosts(userId, limit);
    if (!posts || posts.length === 0) { return null; }

    const tally = new Map();
    let total = 0;

    for (const post of posts) {
        const detected = detectLanguageFromCaption(post.caption || '');
        const lang = detected?.isoCode || post.language || null;

        if (!lang) { continue; }

        total += 1;
        tally.set(lang, (tally.get(lang) || 0) + 1);
    }

    if (total === 0) { return null; }

    const distribution = {};
    for (const [lang, count] of tally.entries()) {
        distribution[lang] = count / total;
    }

    return distribution;
}

export async function recommendLanguage({
    userId,
    captionText,
    preferredLanguage,
    imageLanguageHint,
    fallbackLanguage = DEFAULT_LANGUAGE
} = {}) {
    const sources = [];

    if (preferredLanguage) {
        return {
            mode: 'single',
            primary: preferredLanguage,
            secondary: null,
            reason: 'user-preference',
            sources: ['preference']
        };
    }

    const captionDetection = captionText ? detectLanguageFromCaption(captionText) : null;
    if (captionDetection) {
        sources.push('caption');
    }

    const distribution = await detectLanguageDistributionForUser(userId);
    if (distribution) {
        sources.push('history');
    }

    const primaryFromCaption = captionDetection?.isoCode;
    if (primaryFromCaption) {
        return {
            mode: 'single',
            primary: primaryFromCaption,
            secondary: null,
            reason: 'caption-detected',
            sources
        };
    }

    if (imageLanguageHint) {
        return {
            mode: 'single',
            primary: imageLanguageHint,
            secondary: null,
            reason: 'image-detected',
            sources: [...sources, 'image']
        };
    }

    if (distribution) {
        const ranked = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
        const [topLang, topShare] = ranked[0];
        const second = ranked[1];
        const secondLang = second?.[0];
        const secondShare = second?.[1] || 0;

        if (topShare >= 0.7) {
            return {
                mode: 'single',
                primary: topLang,
                secondary: null,
                reason: 'audience-majority',
                sources
            };
        }

        if (topShare >= 0.5 && secondShare >= 0.2) {
            return {
                mode: 'bilingual',
                primary: topLang,
                secondary: secondLang,
                reason: 'audience-mixed',
                sources
            };
        }

        return {
            mode: 'single',
            primary: topLang,
            secondary: null,
            reason: 'audience-default',
            sources
        };
    }

    return {
        mode: 'single',
        primary: fallbackLanguage,
        secondary: null,
        reason: 'fallback',
        sources
    };
}

export function describeLanguage(isoCode) {
    if (!isoCode) { return null; }
    return LANGUAGE_LABELS[isoCode] || isoCode;
}

export default {
    detectLanguageFromCaption,
    detectLanguageDistributionForUser,
    recommendLanguage,
    describeLanguage,
    LANGUAGE_LABELS
};

