import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs/promises'; // For reading the JSON file
import path from 'path';     // For constructing file paths
import { fileURLToPath } from 'url';
import { describeLanguage } from './languageService.js';

dotenv.config();

// Helper to get __dirname in ES Module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to your hashtags.json file
const HASHTAGS_DATA_PATH = path.join(__dirname, '../../data/hashtags.json');

class GeminiService {
    constructor() {
        console.log('GeminiService: Constructor called.');
        if (!process.env.GEMINI_API_KEY) {
            console.warn('⚠️ GEMINI_API_KEY not provided. AI generation will not work.');
            this.genAI = null;
            this.textModel = null;
            this.visionModel = null;
            return;
        }

        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        this.textModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        console.log('GeminiService: Models initialized (1.5 series).');

        this.hashtagsData = {
            bannedHashtags: [],
            overusedHashtags: [],
            safeHashtagsExamples: {}
        };
        this.loadHashtagsData(); // Load hashtag data on startup
    }

    // New method to load hashtag data from JSON
    async loadHashtagsData() {
        try {
            const data = await fs.readFile(HASHTAGS_DATA_PATH, 'utf8');
            this.hashtagsData = JSON.parse(data);
            console.log('GeminiService: Hashtag data loaded successfully.');
        } catch (error) {
            console.error('GeminiService: Failed to load hashtags.json:', error);
        }
    }

    /**
     * Generates a single caption and hashtags, now incorporating ADVANCED brand voice vectors.
     * @param {object} params - Parameters for generation.
     * @param {string} params.topic - The main topic of the post.
     * @param {string} params.mood - The desired mood/tone of the caption.
     * @param {string} params.persona - The persona/style of the caption.
     * @param {string} [params.trendingTopic] - An optional trending topic to incorporate.
     * @param {string} [params.language='English'] - The desired language for the output.
     * @param {string} [params.brandVoice] - The user's preferred brand voice (basic).
     * @param {object} [params.voiceProfile] - ADVANCED: User's voice profile with vectors.
     * @param {string} [params.targetAudience] - The user's target audience description.
     * @returns {Promise<{caption: string, hashtags: string[]}>} Generated caption and hashtags.
     */
    async generateCaptionAndHashtags({ topic, mood, persona, trendingTopic, language = 'English', brandVoice, voiceProfile, targetAudience, userPreferences }) {
        console.log('GeminiService: generateCaptionAndHashtags called (with advanced brand voice).');
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        try {
            // Use advanced voice profile if available, otherwise fall back to basic brand voice
            const prompt = this.buildAdvancedPrompt({ 
                topic, mood, persona, trendingTopic, language, 
                brandVoice, voiceProfile, targetAudience,
                memoryContext: this.buildMemoryContext(userPreferences)
            });
            console.log('GeminiService: Advanced prompt built:', prompt.substring(0, 200) + '...');

            const generationConfig = {
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 2048,
            };
            console.log('GeminiService: Calling textModel.generateContent for single output...');

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw text response received.');

            return this.parseJsonOrLegacyResponse(text);
        } catch (error) {
            console.error('GeminiService: Error in generateCaptionAndHashtags:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request.'); }
            throw new Error('Failed to generate text content. Please try again.');
        }
    }

    /**
     * Generates a single image-based caption and hashtags, now incorporating ADVANCED brand voice.
     * @param {object} params - Parameters for generation.
     * @param {string} params.base64Image - Base64 encoded image data.
     * @param {string} params.mimeType - MIME type of the image.
     * @param {string} [params.trendingTopic] - An optional trending topic to incorporate.
     * @param {string} [params.language='English'] - The desired language for the output.
     * @param {string} [params.brandVoice] - The user's preferred brand voice.
     * @param {object} [params.voiceProfile] - ADVANCED: User's voice profile with vectors.
     * @param {string} [params.targetAudience] - The user's target audience description.
     * @returns {Promise<{caption: string, hashtags: string[]}>} Generated caption and hashtags.
     */
    async generateCaptionAndHashtagsFromImage({ base64Image, mimeType, trendingTopic, language = 'English', brandVoice, voiceProfile, targetAudience }) {
        console.log('GeminiService: generateCaptionAndHashtagsFromImage called (with advanced brand voice).');
        if (!this.visionModel) {
            throw new Error('Gemini vision client not initialized. Please check your API key.');
        }

        const imagePart = { inlineData: { data: base64Image, mimeType: mimeType } };
        let promptText = `Analyze this image. Identify the main subject, overall mood, and any noticeable emotions or activities.
Based on your analysis, generate:
- An engaging Instagram caption (under 30 words, with emojis) that captures the essence and mood of the image.
- 15 to 20 relevant, diverse, and unique hashtags.
`;
        
        // Add advanced voice profile instructions if available
        if (voiceProfile) {
            promptText += this.buildVoiceProfileInstructions(voiceProfile);
        } else if (brandVoice) {
            promptText += `\nAdopt a "${brandVoice}" brand voice.`;
        }
        
        if (trendingTopic) {
            promptText += `\nSubtly incorporate the trending topic "${trendingTopic}" if it fits naturally with the image.`;
        }
        if (language && language !== 'English') {
            promptText += `\nWrite the caption and hashtags in ${language}.`;
        }
        if (targetAudience) {
            promptText += `\nTailor the content for a target audience of "${targetAudience}".`;
        }

        promptText += `
Format your response exactly like this:
CAPTION: [your caption here]
HASHTAGS: [hashtag1, hashtag2, ..., hashtagN]

Do not include the # symbol in the hashtags list - just the words.`;
        console.log('GeminiService: Image prompt built:', promptText.substring(0, 200) + '...');

        try {
            const generationConfig = { temperature: 0.8, topP: 0.9, topK: 40, maxOutputTokens: 2048 };
            console.log('GeminiService: Calling visionModel.generateContent for single output...');

            const result = await this.visionModel.generateContent([promptText, imagePart], generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw image response received.');

            return this.parseJsonOrLegacyResponse(text);
        } catch (error) {
            console.error('GeminiService: Error in generateCaptionAndHashtagsFromImage:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key for Vision model.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini Vision API quota exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for Vision model.'); }
            else if (error.message?.includes('Unsupported image format')) { throw new Error('Unsupported image format.'); }
            throw new Error('Failed to generate content from image. Please try again.');
        }
    }

    /**
     * Generates a hybrid caption payload that supports multilingual + alternate outputs.
     */
    async generateHybridCaptionBundle({
        topic,
        mood,
        persona,
        context,
        trendingTopic,
        brandVoice,
        voiceProfile,
        targetAudience,
        language,
        languageRecommendation,
        style = {},
        imageSummary
    }) {
        console.log('GeminiService: generateHybridCaptionBundle called.');
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        const languageDirective = this.buildLanguageDirective(language, languageRecommendation);
        const styleConstraints = this.buildStyleConstraintPrompt(style, voiceProfile, brandVoice);

        const promptSections = [
            `You are an elite Instagram copywriter. Produce strictly valid minified JSON with keys primaryCaption, hashtags, alternateCaptions, notes.`,
            `primaryCaption: main caption following the language + style rules.`,
            `hashtags: { "local": [], "universal": [], "combined": [] }`,
            `alternateCaptions: array of objects { "lang": "<iso>", "caption": "<text>" }`,
            `notes: short string explaining the decision.`,
            `Rules:`,
            `1. ${languageDirective.text}`,
            `2. Hashtags: max 15 combined, at least 3 local-language entries if applicable.`,
            `3. ${styleConstraints}`,
            `4. Keep captions under 35 words unless style.length === 'long'.`,
            `5. Include tasteful emojis per style. Avoid # inside hashtag arrays (strings only).`,
            `Context:`,
            `- Topic: ${topic || 'General'}`,
            `- Mood: ${mood || 'authentic'}`,
            `- Persona: ${persona || 'influencer'}`,
            targetAudience ? `- Target Audience: ${targetAudience}` : '',
            brandVoice ? `- Brand Voice: ${brandVoice}` : '',
            trendingTopic ? `- Trending Topic: ${trendingTopic}` : '',
            context ? `- Additional Context: ${context}` : '',
            imageSummary ? `- Image Summary: ${imageSummary}` : '',
            `Output JSON only.`
        ].filter(Boolean).join('\n');

        try {
            const generationConfig = {
                temperature: 0.65,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 512,
            };

            const result = await this.textModel.generateContent(promptSections, generationConfig);
            const response = result.response;
            const raw = response.text();
            console.log('GeminiService: Hybrid RAW response:', raw);

            const parsed = this.parseHybridJson(raw);
            return {
                ...parsed,
                languageMetadata: languageDirective.metadata
            };
        } catch (error) {
            console.error('GeminiService: Error in generateHybridCaptionBundle:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota exceeded.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for hybrid generation.'); }
            throw new Error('Failed to generate hybrid caption content. Please try again.');
        }
    }

    /**
     * ========== ADVANCED BRAND VOICE ENGINE METHODS ==========
     */

    /**
     * Analyzes content to extract voice characteristics for ML training
     * @param {object} params
     * @param {string} params.contentText - The text content to analyze
     * @param {string} params.contentType - Type of content ('caption', 'hashtag', 'rewritten_caption')
     * @param {string} [params.language='English'] - Language of the content
     * @returns {Promise<object>} Analysis results with voice vectors
     */
    async analyzeContentVoice({ contentText, contentType, language = 'English' }) {
        console.log('GeminiService: analyzeContentVoice called for content analysis.');
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        const prompt = this.buildVoiceAnalysisPrompt({ contentText, contentType, language });
        console.log('GeminiService: Voice analysis prompt built.');

        try {
            const generationConfig = {
                temperature: 0.3, // Lower temperature for more consistent analysis
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 500,
            };

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw voice analysis response received.');

            return this.parseVoiceAnalysis(text);
        } catch (error) {
            console.error('GeminiService: Error in analyzeContentVoice:', error);
            throw new Error('Failed to analyze content voice characteristics.');
        }
    }

    /**
     * Generates a refined voice profile based on analyzed content and user feedback
     * @param {object} params
     * @param {Array} params.contentAnalysis - Array of analyzed content with voice vectors
     * @param {Array} params.userFeedback - Array of user feedback data
     * @param {object} params.currentProfile - Current voice profile (if any)
     * @returns {Promise<object>} Refined voice profile with updated vectors
     */
    async refineVoiceProfile({ contentAnalysis, userFeedback, currentProfile }) {
        console.log('GeminiService: refineVoiceProfile called for ML refinement.');
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        const prompt = this.buildVoiceRefinementPrompt({ contentAnalysis, userFeedback, currentProfile });
        console.log('GeminiService: Voice refinement prompt built.');

        try {
            const generationConfig = {
                temperature: 0.4,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 800,
            };

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw voice refinement response received.');

            return this.parseVoiceRefinement(text);
        } catch (error) {
            console.error('GeminiService: Error in refineVoiceProfile:', error);
            throw new Error('Failed to refine voice profile.');
        }
    }

    /**
     * ========== PROMPT BUILDERS FOR ADVANCED BRAND VOICE ==========
     */

    /**
     * Builds advanced prompt with voice profile integration
     * @param {object} params
     * @returns {string} Advanced prompt with voice vectors
     */
    buildAdvancedPrompt({ topic, mood, persona, trendingTopic, language, brandVoice, voiceProfile, targetAudience, memoryContext = '' }) {
        let prompt = `You are an expert Instagram caption writer.

${memoryContext || 'User has no saved preferences. Default to friendly, conversational tone.'}

Task Rules:
1. Follow user preferences STRICTLY.
2. Maintain consistent style across generations.
3. Match the emoji level and caption length targets.
4. Follow structure patterns when composing the caption.
5. Output the final response in JSON format ONLY.

Generate an Instagram caption and 10 relevant hashtags for the following:

Topic: "${topic}"
Mood: ${mood}
Persona: ${persona}`;

        // Add advanced voice profile if available, otherwise use basic brand voice
        if (voiceProfile) {
            prompt += this.buildVoiceProfileInstructions(voiceProfile);
        } else if (brandVoice) {
            prompt += `\nBrand Voice: ${brandVoice}`;
        }

        if (targetAudience) {
            prompt += `\nTarget Audience: ${targetAudience}`;
        }

        if (trendingTopic) {
            prompt += `\nTrending Topic to incorporate: "${trendingTopic}"`;
        }

        prompt += `\n\nRequirements:
- Caption should be ${mood} and reflect the ${persona} persona`;

        // Integrate advanced voice characteristics
        if (voiceProfile) {
            prompt += this.buildVoiceRequirements(voiceProfile);
        } else if (brandVoice) {
            prompt += ` with a "${brandVoice}" brand voice`;
        }

        if (targetAudience) {
            prompt += ` tailored for a "${targetAudience}" target audience`;
        }

        prompt += `
- Keep the caption engaging and under 30 words (unless user preference says otherwise)
- Include relevant emojis naturally following the emoji level target
- Make it authentic and relatable
- Focus on engagement and storytelling`;

        if (trendingTopic) {
            prompt += `\n- Subtly incorporate the trending topic "${trendingTopic}" if it fits naturally`;
        }

        if (language) {
            prompt += `\n- Write the caption and hashtags in ${language}.`;
        }

        prompt += `\n- Provide exactly 10 hashtags that are:
    * Mix of popular and niche hashtags
    * Relevant to the topic and audience
    * Include branded hashtags if applicable
    * Range from high-volume to targeted hashtags

Format your response exactly like this:
CAPTION: [your caption here]
HASHTAGS: [hashtag1, hashtag2, hashtag3, hashtag4, hashtag5, hashtag6, hashtag7, hashtag8, hashtag9, hashtag10]

Do not include the # symbol in the hashtags list - just the words.`;
        return prompt;
    }

    buildMemoryContext(preferences = {}) {
        if (!preferences || Object.keys(preferences).length === 0) {
            return 'No explicit user preferences provided.';
        }

        const {
            preferred_tone,
            emoji_level,
            common_phrases = [],
            disliked_phrases = [],
            caption_length_preference,
            caption_structure,
            language_preference
        } = preferences;

        const structureText = caption_structure
            ? JSON.stringify(caption_structure)
            : 'No structure rules provided.';

        return `User's writing preferences you MUST follow:
- Tone: ${preferred_tone || 'casual'}
- Emoji level target: ${emoji_level ?? 2} (0 to 5 scale)
- Use these phrases when appropriate: ${common_phrases.length ? common_phrases.join(', ') : 'None'}
- Avoid these: ${disliked_phrases.length ? disliked_phrases.join(', ') : 'None'}
- Preferred caption length: ${caption_length_preference || 'medium'}
- Structure rules: ${structureText}
- Preferred language: ${language_preference || 'en'}`;
    }

    buildLanguageDirective(language, languageRecommendation) {
        if (languageRecommendation) {
            const { mode = 'single', primary, secondary, reason, sources = [] } = languageRecommendation;
            const primaryLabel = describeLanguage(primary) || language || 'English';
            const secondaryLabel = describeLanguage(secondary);

            let text = `Write the primary caption and local hashtags in ${primaryLabel}.`;
            if (mode === 'bilingual' && secondaryLabel) {
                text += ` Also generate one alternate caption in ${secondaryLabel} and ensure combined hashtags remain cross-language friendly.`;
            } else {
                text += ' Provide at least one alternate caption in global English if different from the primary language.';
            }

            return {
                text,
                metadata: {
                    mode,
                    primary,
                    primaryLabel,
                    secondary,
                    secondaryLabel,
                    reason,
                    sources
                }
            };
        }

        if (language) {
            return {
                text: `Write all content in ${language}.`,
                metadata: { mode: 'single', primaryLabel: language }
            };
        }

        return {
            text: 'Write all content in English.',
            metadata: { mode: 'single', primary: 'en', primaryLabel: 'English' }
        };
    }

    buildStyleConstraintPrompt(style = {}, voiceProfile = {}, brandVoice) {
        const effective = {
            formality: Number(style.formality ?? voiceProfile.formality ?? 0.5),
            emotional: Number(style.emotional ?? voiceProfile.emotional_tone ?? 0.5),
            funny: Number(style.funny ?? voiceProfile.humor ?? 0.3),
            length: style.length || 'medium',
            emojiLevel: Number(style.emojiLevel ?? 2),
            genZ: Number(style.genZ ?? 0.3)
        };

        const constraints = [];

        if (effective.formality >= 0.7) { constraints.push('Adopt a formal tone and avoid contractions'); }
        else if (effective.formality <= 0.3) { constraints.push('Use a casual conversational tone with contractions'); }
        else { constraints.push('Tone should feel polished yet approachable'); }

        if (effective.emotional >= 0.7) { constraints.push('Lean into emotional storytelling and feelings'); }
        else if (effective.emotional <= 0.3) { constraints.push('Keep emotions neutral and informative'); }

        if (effective.funny >= 0.6) { constraints.push('Include light humor or witty phrasing'); }
        else if (effective.funny <= 0.2) { constraints.push('Avoid humor or jokes'); }

        if (effective.emojiLevel <= 0) { constraints.push('Do not use emojis'); }
        else if (effective.emojiLevel <= 2) { constraints.push('Use 1 emoji max placed naturally'); }
        else if (effective.emojiLevel <= 4) { constraints.push('Use 2-3 emojis blended into the caption'); }
        else { constraints.push('Use emojis generously but keep readability high'); }

        if (effective.genZ >= 0.6) { constraints.push('Sprinkle tasteful Gen-Z slang sparingly'); }
        else if (effective.genZ <= 0.2) { constraints.push('Avoid slang and keep it timeless'); }

        if (effective.length === 'short') { constraints.push('Limit caption to <= 120 characters'); }
        else if (effective.length === 'medium') { constraints.push('Aim for 120-220 characters'); }
        else { constraints.push('Allow up to 400 characters if needed'); }

        if (brandVoice) {
            constraints.push(`Make sure the overall voice feels "${brandVoice}".`);
        }

        return constraints.join('. ');
    }

    parseHybridJson(rawText) {
        if (!rawText) {
            return this.defaultHybridPayload();
        }

        const cleaned = rawText
            .replace(/```json/gi, '```')
            .replace(/```/g, '')
            .trim();

        try {
            const parsed = JSON.parse(cleaned);
            return {
                primaryCaption: parsed.primaryCaption || parsed.caption || '',
                hashtags: parsed.hashtags || { local: [], universal: [], combined: [] },
                alternateCaptions: parsed.alternateCaptions || [],
                notes: parsed.notes || ''
            };
        } catch (error) {
            console.warn('GeminiService: Failed to parse hybrid JSON, falling back.', error.message);
            return this.defaultHybridPayload();
        }
    }

    defaultHybridPayload() {
        return {
            primaryCaption: '',
            hashtags: { local: [], universal: [], combined: [] },
            alternateCaptions: [],
            notes: ''
        };
    }

    /**
     * Builds voice profile instructions for prompt engineering
     * @param {object} voiceProfile - Voice profile with vectors
     * @returns {string} Voice profile instructions
     */
    buildVoiceProfileInstructions(voiceProfile) {
        const instructions = [];
        
        if (voiceProfile.formality !== 0.5) {
            const level = voiceProfile.formality > 0.7 ? 'highly formal' : 
                         voiceProfile.formality > 0.6 ? 'formal' :
                         voiceProfile.formality < 0.3 ? 'very casual' : 'casual';
            instructions.push(level + ' language');
        }

        if (voiceProfile.humor !== 0.5) {
            const level = voiceProfile.humor > 0.7 ? 'very humorous and playful' :
                         voiceProfile.humor > 0.6 ? 'humorous' :
                         voiceProfile.humor < 0.3 ? 'serious and straightforward' : 'slightly humorous';
            instructions.push(level + ' tone');
        }

        if (voiceProfile.enthusiasm !== 0.5) {
            const level = voiceProfile.enthusiasm > 0.7 ? 'very enthusiastic and energetic' :
                         voiceProfile.enthusiasm > 0.6 ? 'enthusiastic' :
                         voiceProfile.enthusiasm < 0.3 ? 'calm and measured' : 'moderately enthusiastic';
            instructions.push(level);
        }

        if (voiceProfile.professionalism !== 0.5) {
            const level = voiceProfile.professionalism > 0.7 ? 'highly professional' :
                         voiceProfile.professionalism > 0.6 ? 'professional' :
                         voiceProfile.professionalism < 0.3 ? 'personal and relatable' : 'balanced professional';
            instructions.push(level + ' approach');
        }

        if (voiceProfile.creativity !== 0.5) {
            const level = voiceProfile.creativity > 0.7 ? 'very creative and imaginative' :
                         voiceProfile.creativity > 0.6 ? 'creative' :
                         voiceProfile.creativity < 0.3 ? 'straightforward and practical' : 'slightly creative';
            instructions.push(level + ' expression');
        }

        if (voiceProfile.emotional_tone !== 0.5) {
            const level = voiceProfile.emotional_tone > 0.7 ? 'very emotional and expressive' :
                         voiceProfile.emotional_tone > 0.6 ? 'emotional' :
                         voiceProfile.emotional_tone < 0.3 ? 'rational and logical' : 'balanced emotional';
            instructions.push(level + ' delivery');
        }

        if (voiceProfile.confidence !== 0.5) {
            const level = voiceProfile.confidence > 0.7 ? 'very confident and assertive' :
                         voiceProfile.confidence > 0.6 ? 'confident' :
                         voiceProfile.confidence < 0.3 ? 'tentative and exploratory' : 'moderately confident';
            instructions.push(level + ' voice');
        }

        if (voiceProfile.warmth !== 0.5) {
            const level = voiceProfile.warmth > 0.7 ? 'very warm and friendly' :
                         voiceProfile.warmth > 0.6 ? 'warm' :
                         voiceProfile.warmth < 0.3 ? 'neutral and objective' : 'slightly warm';
            instructions.push(level + ' demeanor');
        }

        if (instructions.length > 0) {
            return `\nAdopt a brand voice that is: ${instructions.join(', ')}.`;
        }

        return '\nAdopt a balanced and authentic brand voice.';
    }

    /**
     * Builds voice requirements section for prompts
     * @param {object} voiceProfile - Voice profile with vectors
     * @returns {string} Voice requirements text
     */
    buildVoiceRequirements(voiceProfile) {
        const requirements = [];

        if (voiceProfile.formality > 0.6) {
            requirements.push('use proper grammar and avoid slang');
        } else if (voiceProfile.formality < 0.4) {
            requirements.push('use casual language and conversational tone');
        }

        if (voiceProfile.humor > 0.6) {
            requirements.push('include witty remarks or playful elements');
        } else if (voiceProfile.humor < 0.4) {
            requirements.push('maintain a serious and straightforward approach');
        }

        if (voiceProfile.enthusiasm > 0.6) {
            requirements.push('show excitement and use energetic language');
        } else if (voiceProfile.enthusiasm < 0.4) {
            requirements.push('keep tone calm and measured');
        }

        if (voiceProfile.creativity > 0.6) {
            requirements.push('be imaginative and use creative expressions');
        } else if (voiceProfile.creativity < 0.4) {
            requirements.push('focus on clear, practical communication');
        }

        if (requirements.length > 0) {
            return `, ensuring you ${requirements.join(', ')}`;
        }

        return '';
    }

    /**
     * Builds prompt for voice analysis
     * @param {object} params
     * @returns {string} Voice analysis prompt
     */
    buildVoiceAnalysisPrompt({ contentText, contentType, language }) {
        return `Analyze the following ${contentType} content and provide a detailed assessment of its voice characteristics:

Content: "${contentText}"
Language: ${language}

Please analyze these specific voice dimensions on a scale of 0 to 1 (where 0.5 is neutral):

1. Formality (0=casual, 1=formal)
2. Humor (0=serious, 1=humorous)
3. Enthusiasm (0=neutral, 1=enthusiastic)
4. Professionalism (0=personal, 1=professional)
5. Creativity (0=straightforward, 1=creative)
6. Emotional Tone (0=rational, 1=emotional)
7. Confidence (0=tentative, 1=confident)
8. Warmth (0=cold, 1=warm)

Format your response exactly as:
FORMALITY: [0.0-1.0]
HUMOR: [0.0-1.0]
ENTHUSIASM: [0.0-1.0]
PROFESSIONALISM: [0.0-1.0]
CREATIVITY: [0.0-1.0]
EMOTIONAL_TONE: [0.0-1.0]
CONFIDENCE: [0.0-1.0]
WARMTH: [0.0-1.0]
CONFIDENCE_SCORE: [0.0-1.0]

Provide only these 9 lines with the scores.`;
    }

    /**
     * Builds prompt for voice profile refinement
     * @param {object} params
     * @returns {string} Voice refinement prompt
     */
    buildVoiceRefinementPrompt({ contentAnalysis, userFeedback, currentProfile }) {
        let prompt = `Based on the following content analysis and user feedback, refine the brand voice profile:\n\n`;

        // Add content analysis summary
        if (contentAnalysis && contentAnalysis.length > 0) {
            prompt += `CONTENT ANALYSIS (${contentAnalysis.length} samples):\n`;
            contentAnalysis.forEach((analysis, index) => {
                prompt += `Sample ${index + 1}: ${analysis.contentText.substring(0, 100)}...\n`;
            });
            prompt += '\n';
        }

        // Add user feedback summary
        if (userFeedback && userFeedback.length > 0) {
            prompt += `USER FEEDBACK (${userFeedback.length} items):\n`;
            userFeedback.forEach((feedback, index) => {
                prompt += `Feedback ${index + 1}: ${feedback.feedbackType} - ${feedback.feedbackComment || 'No comment'}\n`;
            });
            prompt += '\n';
        }

        // Add current profile
        if (currentProfile) {
            prompt += `CURRENT VOICE PROFILE:\n`;
            Object.keys(currentProfile).forEach(key => {
                if (typeof currentProfile[key] === 'number' && key !== 'id' && key !== 'user_id') {
                    prompt += `${key.toUpperCase()}: ${currentProfile[key]}\n`;
                }
            });
            prompt += '\n';
        }

        prompt += `Provide refined voice profile scores that better match the user's preferred style based on the analysis above.\n\n`;
        prompt += `Format your response exactly as:
FORMALITY: [refined 0.0-1.0]
HUMOR: [refined 0.0-1.0]
ENTHUSIASM: [refined 0.0-1.0]
PROFESSIONALISM: [refined 0.0-1.0]
CREATIVITY: [refined 0.0-1.0]
EMOTIONAL_TONE: [refined 0.0-1.0]
CONFIDENCE: [refined 0.0-1.0]
WARMTH: [refined 0.0-1.0]
REASONING: [brief explanation of changes]`;

        return prompt;
    }

    /**
     * ========== PARSERS FOR ADVANCED BRAND VOICE ==========
     */

    /**
     * Parses voice analysis response into structured data
     * @param {string} responseText - Raw analysis response
     * @returns {object} Structured voice analysis
     */
    parseVoiceAnalysis(responseText) {
        console.log('GeminiService: Parsing voice analysis response.');
        const lines = responseText.split('\n').filter(line => line.trim());
        const analysis = {};

        lines.forEach(line => {
            const [key, value] = line.split(':').map(part => part.trim());
            if (key && value) {
                const numValue = parseFloat(value);
                if (!isNaN(numValue)) {
                    analysis[key.toLowerCase()] = numValue;
                }
            }
        });

        // Ensure all required fields are present
        const requiredFields = ['formality', 'humor', 'enthusiasm', 'professionalism', 'creativity', 'emotional_tone', 'confidence', 'warmth', 'confidence_score'];
        requiredFields.forEach(field => {
            if (analysis[field] === undefined) {
                analysis[field] = 0.5; // Default neutral value
            }
        });

        return analysis;
    }

    /**
     * Parses voice refinement response
     * @param {string} responseText - Raw refinement response
     * @returns {object} Refined voice profile
     */
    parseVoiceRefinement(responseText) {
        console.log('GeminiService: Parsing voice refinement response.');
        const lines = responseText.split('\n').filter(line => line.trim());
        const refinedProfile = {};
        let reasoning = '';

        lines.forEach(line => {
            if (line.startsWith('REASONING:')) {
                reasoning = line.replace('REASONING:', '').trim();
            } else {
                const [key, value] = line.split(':').map(part => part.trim());
                if (key && value) {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        refinedProfile[key.toLowerCase()] = Math.max(0, Math.min(1, numValue)); // Clamp between 0-1
                    }
                }
            }
        });

        return {
            ...refinedProfile,
            reasoning: reasoning || 'Profile refined based on analysis and feedback.'
        };
    }

    /**
     * ========== EXISTING METHODS (UNCHANGED) ==========
     */

    /**
     * Rewrites an existing caption into multiple versions based on mood and length.
     */
    async rewriteCaption({ originalCaption, mood, length, language = 'English' }) {
        console.log(`GeminiService: rewriteCaption called for original: "${originalCaption.substring(0, 50)}..."`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        try {
            const prompt = this.buildRewritePrompt({ originalCaption, mood, length, language });
            console.log('GeminiService: Rewrite prompt built:', prompt.substring(0, 100) + '...');

            const generationConfig = {
                temperature: 0.9,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 500,
            };
            console.log('GeminiService: Calling textModel.generateContent for caption rewriting...');

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw rewrite text response received.');

            return this.parseRewrittenCaptions(text);
        } catch (error) {
            console.error('GeminiService: Error in rewriteCaption:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota for caption rewriting exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for caption rewriting.'); }
            throw new Error('Failed to rewrite caption. Please try again.');
        }
    }

    /**
     * Suggests relevant emojis based on provided caption context.
     */
    async suggestEmojis({ captionText, mood, topic, persona, language = 'English' }) {
        console.log(`GeminiService: suggestEmojis called for text: "${captionText.substring(0, 50)}..."`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        // ... (existing emoji suggestion code remains unchanged)
        let prompt = `You are an expert in social media content. For the given caption and context, provide 5 distinct categories of emoji usage, each with 3-5 highly relevant emojis. Aim for diverse categories based on the content's tone and purpose.`;

        if (captionText) {
            prompt += `\nCaption: "${captionText}"`;
        }
        if (mood) {
            prompt += `\nMood: ${mood}`;
        }
        if (topic) {
            prompt += `\nTopic: ${topic}`;
        }
        if (persona) {
            prompt += `\nPersona: ${persona}`;
        }
        if (language && language !== 'English') {
            prompt += `\nAll suggestions should be highly relevant for content in ${language}.`;
        }

        prompt += `

Here are the 5 categories I need. Make sure each category name is distinct and descriptive.
1.  **Emotional Connection:** Emojis that evoke feelings or empathy.
2.  **Visual Enhancement:** Emojis that add visual interest or decorate the text.
3.  **Topic Specific:** Emojis directly related to the core subject matter of the caption.
4.  **Activity/Action:** Emojis representing actions, events, or calls to engagement.
5.  **Humor/Playfulness:** Emojis that add a lighthearted or funny touch.

If the content naturally suggests other strong categories (e.g., "Celebration," "Nature," "Travel"), feel free to use those instead of the default ones above, but always provide 5 distinct categories.

Format your response STRICTLY as follows:
TYPE: [Category Name 1]
EMOJIS: [emoji1, emoji2, emoji3, emoji4, emoji5]

TYPE: [Category Name 2]
EMOJIS: [emoji1, emoji2, emoji3, emoji4, emoji5]

TYPE: [Category Name 3]
EMOJIS: [emoji1, emoji2, emoji3, emoji4, emoji5]

TYPE: [Category Name 4]
EMOJIS: [emoji1, emoji2, emoji3, emoji4, emoji5]

TYPE: [Category Name 5]
EMOJIS: [emoji1, emoji2, emoji3, emoji4, emoji5]

Do NOT include any extra text, explanations, or numbering outside of this exact format.
Example:
TYPE: Emotional Connection
EMOJIS: [💖,🥺,🥹]

TYPE: Visual Enhancement
EMOJIS: [✨,🌸,💎]

TYPE: Topic Specific
EMOJIS: [☕,📚,🏙️]

TYPE: Activity/Action
EMOJIS: [👇,💡,✨]

TYPE: Humor/Playfulness
EMOJIS: [😂,😜,🙈]
`;

        console.log('GeminiService: Emoji prompt built:', prompt.substring(0, 100) + '...');

        try {
            const generationConfig = {
                temperature: 0.8,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 350,
            };

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw structured emoji response received:', text);

            return this.parseStructuredEmojisResponse(text);
        } catch (error) {
            console.error('GeminiService: Error in suggestEmojis:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key for emoji suggestion.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota for emoji suggestion exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters for emoji suggestion.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for emoji suggestion.'); }
            throw new Error('Failed to suggest emojis. Please try again.');
        }
    }

    /**
     * Analyzes hashtags using both local data and AI.
     */
    async analyzeHashtagsAI({ hashtags, captionText = '', language = 'English' }) {
        console.log(`GeminiService: analyzeHashtagsAI called for ${hashtags.length} hashtags.`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        const results = [];
        const uniqueHashtags = [...new Set(hashtags.map(tag => tag.toLowerCase()))];

        for (const tag of uniqueHashtags) {
            if (this.hashtagsData.bannedHashtags.includes(tag)) {
                results.push({ hashtag: tag, category: 'banned', reason: 'Explicitly banned by platform.' });
                continue;
            }

            if (this.hashtagsData.overusedHashtags.includes(tag)) {
                results.push({ hashtag: tag, category: 'overused', reason: 'Extremely popular, content may get lost quickly.' });
                continue;
            }

            try {
                const aiPrompt = this.buildHashtagAnalysisPrompt({ hashtag: tag, captionText, language });
                const generationConfig = { temperature: 0.5, topP: 0.9, topK: 40, maxOutputTokens: 100 };
                
                const result = await this.textModel.generateContent(aiPrompt, generationConfig);
                const response = result.response;
                const aiAnalysis = response.text().trim().toLowerCase();

                if (aiAnalysis.includes('spammy') || aiAnalysis.includes('low quality') || aiAnalysis.includes('engagement bait') || aiAnalysis.includes('generic') && aiAnalysis.includes('low quality')) {
                    results.push({ hashtag: tag, category: 'spammy/low_quality', reason: aiAnalysis });
                } else if (aiAnalysis.includes('controversial') || aiAnalysis.includes('sensitive') || aiAnalysis.includes('policy violation') || aiAnalysis.includes('misinterpreted') || aiAnalysis.includes('flagged')) {
                    results.push({ hashtag: tag, category: 'caution', reason: aiAnalysis });
                } else if (aiAnalysis.includes('niche') || aiAnalysis.includes('specific') || aiAnalysis.includes('targeted') || aiAnalysis.includes('relevant')) {
                    results.push({ hashtag: tag, category: 'safe/niche', reason: aiAnalysis });
                } else if (aiAnalysis.includes('popular') || aiAnalysis.includes('high volume') || aiAnalysis.includes('generic') && aiAnalysis.includes('broad')) {
                    results.push({ hashtag: tag, category: 'overused_ai', reason: aiAnalysis });
                } else {
                    results.push({ hashtag: tag, category: 'safe', reason: aiAnalysis || 'General purpose and likely safe.' });
                }

            } catch (aiError) {
                console.warn(`GeminiService: AI analysis failed for hashtag "${tag}":`, aiError.message);
                results.push({ hashtag: tag, category: 'unknown', reason: `AI analysis failed: ${aiError.message}.` });
            }
        }
        console.log('GeminiService: Hashtag analysis complete:', results);
        return results;
    }

    // AI-Powered Scheduling Assistant (unchanged)
    async suggestOptimalPostingTime({ persona, topic, audienceType, currentDayOfWeek = 'any' }) {
        console.log('GeminiService: suggestOptimalPostingTime called.');
        if (!this.textModel) { throw new Error('Gemini text client not initialized. Please check your API key.'); }
        const prompt = `You are an expert social media manager specializing in Instagram engagement.
        Given the following context, suggest 3 optimal times for posting on Instagram to maximize reach and engagement.

        Persona: ${persona}
        Topic/Content Type: ${topic}
        Target Audience Type: ${audienceType}
        Current Day of Week: ${currentDayOfWeek}

        Provide ONLY the times in HH:MM (24-hour) format, comma-separated.
        Example: "09:30, 14:00, 20:30"
        `;
        try {
            const generationConfig = { temperature: 0.7, topP: 0.9, topK: 40, maxOutputTokens: 50 };
            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw optimal time response:', text);
            return this.parseOptimalTimes(text);
        } catch (error) {
            console.error('GeminiService: Error in suggestOptimalPostingTime:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota for time suggestion exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for optimal time suggestion.'); }
            throw new Error('Failed to get optimal posting time suggestions. Please try again.');
        }
    }

    parseOptimalTimes(responseText) {
        const times = responseText.split(',').map(time => time.trim()).filter(time => /^\d{2}:\d{2}$/.test(time));
        if (times.length === 0) { console.warn('GeminiService: No valid optimal times found in response, falling back to defaults.'); return ['09:00', '13:00', '19:00']; }
        return times.slice(0, 3);
    }

    /**
     * UPDATED: buildPrompt method to include brandVoice and targetAudience.
     * @param {object} params - Parameters for building the prompt.
     * @param {string} params.topic - The main topic.
     * @param {string} params.mood - The desired mood.
     * @param {string} params.persona - The content persona.
     * @param {string} [params.trendingTopic] - Optional trending topic.
     * @param {string} [params.language] - Desired language.
     * @param {string} [params.brandVoice] - User's preferred brand voice.
     * @param {string} [params.targetAudience] - User's target audience description.
     * @returns {string} The constructed prompt string.
     */
    buildPrompt({ topic, mood, persona, trendingTopic, language, brandVoice, targetAudience }) {
        let prompt = `Generate an Instagram caption and 10 relevant hashtags for the following:

Topic: "${topic}"
Mood: ${mood}
Persona: ${persona}`;

        // Add brand voice and target audience to the initial context
        if (brandVoice) {
            prompt += `\nBrand Voice: ${brandVoice}`;
        }
        if (targetAudience) {
            prompt += `\nTarget Audience: ${targetAudience}`;
        }

        if (trendingTopic) {
            prompt += `\nTrending Topic to incorporate: "${trendingTopic}"`;
        }

        prompt += `\n\nRequirements:
- Caption should be ${mood} and reflect the ${persona} persona`;

        // Integrate brand voice and target audience into the caption requirements
        if (brandVoice) {
            prompt += ` with a "${brandVoice}" brand voice`;
        }
        if (targetAudience) {
            prompt += ` tailored for a "${targetAudience}" target audience`;
        }
        prompt += `
- Keep the caption engaging and under 30 words
- Include relevant emojis naturally
- Make it authentic and relatable
- Focus on engagement and storytelling`;

        if (trendingTopic) {
            prompt += `\n- Subtly incorporate the trending topic "${trendingTopic}" if it fits naturally`;
        }

        if (language) {
            prompt += `\n- Write the caption and hashtags in ${language}.`;
        }

        prompt += `\n- Provide exactly 10 hashtags that are:
    * Mix of popular and niche hashtags
    * Relevant to the topic and audience
    * Include branded hashtags if applicable
    * Range from high-volume to targeted hashtags

Format your response exactly like this:
CAPTION: [your caption here]
HASHTAGS: [hashtag1, hashtag2, hashtag3, hashtag4, hashtag5, hashtag6, hashtag7, hashtag8, hashtag9, hashtag10]

Do not include the # symbol in the hashtags list - just the words.`;
        return prompt;
    }

    /**
     * Builds the prompt specifically for rewriting an existing caption.
     */
    buildRewritePrompt({ originalCaption, mood, length, language }) {
        let prompt = `You are an expert copywriter. Rewrite the following Instagram caption into 3-5 alternative versions.
        
Original Caption: "${originalCaption}"

Requirements for rewritten captions:
- Mood: ${mood}
- Length: ${length} (e.g., "Short & Punchy" means concise, "Medium" is balanced, "Long & Detailed" allows for more storytelling)
- Each rewritten caption should be distinct and creative.
- Include relevant emojis where appropriate.`;

        if (language && language !== 'English') {
            prompt += `\n- Write all suggested captions in ${language}.`;
        }
        
        prompt += `

Format your response as a numbered list, with each caption on a new line. Do NOT include any additional text, explanations, or leading/trailing statements. Just the numbered list of captions.

Example:
1. This is the first rewritten caption.
2. Here is another, slightly different, version.
3. A third option for you to consider.
`;
        return prompt;
    }

    /**
     * Builds a prompt for Gemini to analyze a single hashtag.
     */
    buildHashtagAnalysisPrompt({ hashtag, captionText, language = 'English' }) {
        let prompt = `Analyze the Instagram hashtag "${hashtag}". Provide a very concise assessment (1-2 sentences). Categorize it as:
- 'safe': Generally good for reach, relevant, not spammy.
- 'overused_ai': Very high volume, content might get lost quickly.
- 'spammy/low_quality': Often associated with low-quality content, bots, or engagement bait.
- 'caution': Potentially sensitive, controversial, or prone to being flagged.

Consider the context: Caption: "${captionText}". Language: ${language}.

Format your response as "CATEGORY: reason" in plain text.
Example: "safe: Relevant to lifestyle bloggers."
Example: "overused_ai: Extremely high volume, very generic."
Example: "spammy/low_quality: Often associated with bot activity."
Example: "caution: Can be misinterpreted or flagged due to sensitive topic."
`;
        return prompt;
    }

    /**
     * Suggests Call-to-Actions (CTAs) based on content and post goal.
     */
    async suggestCTAs({ captionText, postGoal, topic, mood, persona, language = 'English', brandVoice, targetAudience }) {
        console.log(`GeminiService: suggestCTAs called for post goal: "${postGoal}"`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        try {
            const prompt = this.buildCTAPrompt({ captionText, postGoal, topic, mood, persona, language, brandVoice, targetAudience });
            console.log('GeminiService: CTA prompt built:', prompt.substring(0, 200) + '...');

            const generationConfig = {
                temperature: 0.7,
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 200,
            };

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw CTA response received:', text);

            return this.parseCTAResponse(text);
        } catch (error) {
            console.error('GeminiService: Error in suggestCTAs:', error);
            if (error.message?.includes('API_KEY_INVALID')) { throw new Error('Invalid Gemini API key for CTA suggestion.'); }
            else if (error.message?.includes('QUOTA_EXCEEDED')) { throw new Error('Gemini API quota for CTA suggestion exceeded.'); }
            else if (error.message?.includes('SAFETY')) { throw new Error('Content blocked by safety filters for CTA suggestion.'); }
            else if (error.code === 400 || error.message?.includes('bad request')) { throw new Error('Invalid request for CTA suggestion.'); }
            throw new Error('Failed to suggest CTAs. Please try again.');
        }
    }

    /**
     * Helper to build the prompt for CTA generation.
     */
    buildCTAPrompt({ captionText, postGoal, topic, mood, persona, language, brandVoice, targetAudience }) {
        let prompt = `You are an expert social media marketer. For the following Instagram caption and desired post goal, suggest 3-5 concise and effective Call-to-Actions (CTAs).

Caption: "${captionText}"
Post Goal: ${postGoal}`;

        if (topic) {
            prompt += `\nTopic: ${topic}`;
        }
        if (mood) {
            prompt += `\nMood: ${mood}`;
        }
        if (persona) {
            prompt += `\nPersona: ${persona}`;
        }
        if (brandVoice) {
            prompt += `\nBrand Voice: ${brandVoice}`;
        }
        if (targetAudience) {
            prompt += `\nTarget Audience: ${targetAudience}`;
        }
        if (language && language !== 'English') {
            prompt += `\nWrite the CTAs in ${language}.`;
        }

        prompt += `

Requirements:
- Each CTA should be short and direct.
- Include relevant emojis if appropriate.
- Focus on driving the specified post goal.

Format your response as a numbered list, with each CTA on a new line. Do NOT include any extra text, explanations, or numbering outside of this exact format.

Example:
1. Link in bio! ✨
2. Tell us in the comments 👇
3. Shop now! 🛍️
`;
        return prompt;
    }

    /**
     * Helper to parse the response from Gemini for CTAs (expected as a numbered list).
     */
    parseCTAResponse(responseText) {
        console.log('GeminiService: Parsing CTA response.');
        const ctas = [];
        const lines = responseText.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            const match = trimmedLine.match(/^\d+\.\s*(.*)/);
            if (match && match[1]) {
                ctas.push(match[1].trim());
            }
        }
        if (ctas.length === 0) {
            console.warn('GeminiService: No numbered list CTAs found, attempting basic line parsing.');
            return responseText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        }
        return ctas;
    }

    // Reintroduced: fallbackParse method (for single output)
    parseResponse(response) {
        console.log('GeminiService: Parsing single response.');
        try {
            const lines = response.split('\n').filter(line => line.trim());
            let caption = '';
            let hashtags = [];

            for (const line of lines) {
                if (line.startsWith('CAPTION:')) { caption = line.replace('CAPTION:', '').trim(); }
                else if (line.startsWith('HASHTAGS:')) {
                    const hashtagString = line.replace('HASHTAGS:', '').trim();
                    const hashtagMatch = hashtagString.match(/\[(.*?)\]/) || [null, hashtagString];
                    if (hashtagMatch[1]) { hashtags = hashtagMatch[1].split(',').map(tag => tag.trim().replace(/^#/, '')).filter(tag => tag.length > 0); }
                }
            }
            if (!caption || hashtags.length === 0) { console.warn('GeminiService: Failed to parse exact format, attempting fallback.'); return this.fallbackParse(response); }
            return { caption: caption, hashtags: hashtags.slice(0, 10) };
        } catch (error) { console.error('GeminiService: Error parsing Gemini response:', error); return this.fallbackParse(response); }
    }

    /**
     * Parses the response from Gemini for rewritten captions (expected as a numbered list).
     */
    parseRewrittenCaptions(responseText) {
        console.log('GeminiService: Parsing rewritten captions response.');
        const captions = [];
        const lines = responseText.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            const match = trimmedLine.match(/^\d+\.\s*(.*)/);
            if (match && match[1]) {
                captions.push(match[1].trim());
            }
        }
        if (captions.length === 0) {
            console.warn('GeminiService: No numbered list captions found, attempting basic line parsing.');
            return responseText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        }
        return captions;
    }

    /**
     * Parses structured emoji suggestions from Gemini.
     */
    parseStructuredEmojisResponse(responseText) {
        console.log('GeminiService: Parsing structured emoji response:', responseText);
        const emojiCategories = [];
        const lines = responseText.split('\n');
        let currentCategory = null;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('TYPE:')) {
                currentCategory = {
                    type: trimmedLine.replace('TYPE:', '').trim(),
                    emojis: []
                };
                emojiCategories.push(currentCategory);
            } else if (trimmedLine.startsWith('EMOJIS:') && currentCategory) {
                const emojisString = trimmedLine.replace('EMOJIS:', '').trim();
                const emojis = emojisString
                    .replace(/^\[|\]$/g, '')
                    .split(',')
                    .map(emoji => emoji.trim())
                    .filter(emoji => emoji.length > 0);
                currentCategory.emojis = emojis;
                currentCategory = null;
            }
        }

        if (emojiCategories.length === 0) {
            console.warn('GeminiService: Failed to parse structured emoji response. Attempting fallback for flat list.');
            const simpleEmojis = responseText.trim().replace(/['"`\n\r]/g, '').split(',').map(emoji => emoji.trim()).filter(emoji => emoji.length > 0);
            if (simpleEmojis.length > 0) {
                return [{ type: 'General Emojis', emojis: simpleEmojis }];
            }
        }

        return emojiCategories;
    }

    parseJsonOrLegacyResponse(responseText) {
        if (!responseText) {
            return this.fallbackParse('');
        }

        const cleaned = responseText
            .replace(/```json/gi, '```')
            .replace(/```/g, '')
            .trim();

        try {
            const parsed = JSON.parse(cleaned);
            const caption = parsed.primaryCaption || parsed.caption || parsed.CAPTION || '';
            let hashtags = [];
            if (Array.isArray(parsed.hashtags)) {
                hashtags = parsed.hashtags;
            } else if (parsed.hashtags?.combined) {
                hashtags = parsed.hashtags.combined;
            } else if (Array.isArray(parsed.HASHTAGS)) {
                hashtags = parsed.HASHTAGS;
            }

            return {
                caption,
                hashtags: hashtags.map(tag => tag.replace(/^#/, '')).slice(0, 10),
                memoryUsed: parsed.memoryUsed || null,
                raw: parsed
            };
        } catch (error) {
            console.warn('GeminiService: JSON parse failed, falling back to legacy parser.', error.message);
            return this.parseResponse(responseText);
        }
    }

    // Reintroduced: fallbackParse method (for single output)
    fallbackParse(response) {
        console.log('GeminiService: Executing fallbackParse for response:', response);
        const lines = response.split('\n').filter(line => line.trim());
        let caption = ''; let hashtags = []; let foundHashtags = false;
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('#')) { foundHashtags = true; const lineHashtags = trimmedLine.match(/#\w+/g) || []; hashtags.push(...lineHashtags.map(tag => tag.replace('#', ''))); }
            else if (!foundHashtags && trimmedLine.length > 10 && !trimmedLine.includes(':') && !trimmedLine.toLowerCase().includes('caption') && !trimmedLine.toLowerCase().includes('hashtags')) { caption = trimmedLine; }
        }
        if (!caption) { console.warn('GeminiService: FallbackParse could not find a caption, using default.'); caption = "✨ Sharing a moment that matters! What's inspiring you today? 💫"; }
        if (hashtags.length === 0) { console.warn('GeminiService: FallbackParse could not find hashtags, using defaults.'); hashtags = ['instagram', 'instagood', 'photooftheday', 'beautiful', 'happy', 'love', 'lifestyle', 'follow', 'like', 'daily']; }
        return { caption: caption, hashtags: hashtags.slice(0, 10) };
    }

    async testConnection() {
        if (!this.textModel) { return { success: false, error: 'Gemini client not initialized' }; }
        try {
            const result = await this.textModel.generateContent('Hello, respond with just "API connection successful"');
            const response = result.response;
            return { success: true, message: response.text() };
        } catch (error) { console.error('GeminiService: Test connection error:', error.message); return { success: false, error: error.message }; }
    }
}

export default new GeminiService();