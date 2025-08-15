import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs/promises'; // For reading the JSON file
import path from 'path';     // For constructing file paths
import { fileURLToPath } from 'url';

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

        this.textModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        this.visionModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
        console.log('GeminiService: Models initialized.');

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
     * Generates a single caption and hashtags, now incorporating brand voice and target audience.
     * @param {object} params - Parameters for generation.
     * @param {string} params.topic - The main topic of the post.
     * @param {string} params.mood - The desired mood/tone of the caption.
     * @param {string} params.persona - The persona/style of the caption.
     * @param {string} [params.trendingTopic] - An optional trending topic to incorporate.
     * @param {string} [params.language='English'] - The desired language for the output.
     * @param {string} [params.brandVoice] - The user's preferred brand voice.
     * @param {string} [params.targetAudience] - The user's target audience description.
     * @returns {Promise<{caption: string, hashtags: string[]}>} Generated caption and hashtags.
     */
    async generateCaptionAndHashtags({ topic, mood, persona, trendingTopic, language = 'English', brandVoice, targetAudience }) {
        console.log('GeminiService: generateCaptionAndHashtags called (single output, multi-language, with brand context).');
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        try {
            // Pass brandVoice and targetAudience to buildPrompt
            const prompt = this.buildPrompt({ topic, mood, persona, trendingTopic, language, brandVoice, targetAudience });
            console.log('GeminiService: Prompt built:', prompt.substring(0, 200) + '...'); // Log more of the prompt

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

            return this.parseResponse(text);
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
     * Generates a single image-based caption and hashtags, now incorporating brand voice and target audience.
     * @param {object} params - Parameters for generation.
     * @param {string} params.base64Image - Base64 encoded image data.
     * @param {string} params.mimeType - MIME type of the image.
     * @param {string} [params.trendingTopic] - An optional trending topic to incorporate.
     * @param {string} [params.language='English'] - The desired language for the output.
     * @param {string} [params.brandVoice] - The user's preferred brand voice.
     * @param {string} [params.targetAudience] - The user's target audience description.
     * @returns {Promise<{caption: string, hashtags: string[]}>} Generated caption and hashtags.
     */
    async generateCaptionAndHashtagsFromImage({ base64Image, mimeType, trendingTopic, language = 'English', brandVoice, targetAudience }) {
        console.log('GeminiService: generateCaptionAndHashtagsFromImage called (single output, multi-language).');
        if (!this.visionModel) {
            throw new Error('Gemini vision client not initialized. Please check your API key.');
        }

        const imagePart = { inlineData: { data: base64Image, mimeType: mimeType } };
        let promptText = `Analyze this image. Identify the main subject, overall mood, and any noticeable emotions or activities.
Based on your analysis, generate:
- An engaging Instagram caption (under 30 words, with emojis) that captures the essence and mood of the image.
- 15 to 20 relevant, diverse, and unique hashtags.
`;
        if (trendingTopic) {
            promptText += `Subtly incorporate the trending topic "${trendingTopic}" if it fits naturally with the image.`;
        }
        if (language && language !== 'English') {
            promptText += `\nWrite the caption and hashtags in ${language}.`;
        }
        // Add brand voice and target audience to image prompt
        if (brandVoice) {
            promptText += `\nAdopt a "${brandVoice}" brand voice.`;
        }
        if (targetAudience) {
            promptText += `\nTailor the content for a target audience of "${targetAudience}".`;
        }

        promptText += `
Format your response exactly like this:
CAPTION: [your caption here]
HASHTAGS: [hashtag1, hashtag2, ..., hashtagN]

Do not include the # symbol in the hashtags list - just the words.`;
        console.log('GeminiService: Image prompt built:', promptText.substring(0, 200) + '...'); // Log more of the prompt

        try {
            const generationConfig = { temperature: 0.8, topP: 0.9, topK: 40, maxOutputTokens: 2048 };
            console.log('GeminiService: Calling visionModel.generateContent for single output...');

            const result = await this.visionModel.generateContent([promptText, imagePart], generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw image response received.');

            return this.parseResponse(text);
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
     * Rewrites an existing caption into multiple versions based on mood and length.
     * @param {string} originalCaption - The caption to be rewritten.
     * @param {string} mood - The desired mood for the rewritten captions (e.g., "Enthusiastic", "Professional", "Funny").
     * @param {string} length - The desired length for the rewritten captions (e.g., "Short & Punchy", "Medium", "Long & Detailed").
     * @param {string} [language='English'] - The desired language for the rewritten captions.
     * @returns {Promise<string[]>} An array of suggested rewritten captions.
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
     * Suggests relevant emojis based on provided caption context, categorized by usage type.
     * @param {object} params
     * @param {string} params.captionText - The current caption text.
     * @param {string} [params.mood] - The associated mood.
     * @param {string} [params.topic] - The associated topic.
     * @param {string} [params.persona] - The associated persona.
     * @param {string} [params.language='English'] - The desired language for emoji relevance.
     * @returns {Promise<Array<{type: string, emojis: string[]}>>} An array of objects, each with a type and an array of emojis.
     */
    async suggestEmojis({ captionText, mood, topic, persona, language = 'English' }) {
        console.log(`GeminiService: suggestEmojis called for text: "${captionText.substring(0, 50)}..."`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        // --- MODIFIED PROMPT START ---
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
        // --- MODIFIED PROMPT END ---

        console.log('GeminiService: Emoji prompt built:', prompt.substring(0, 100) + '...');

        try {
            const generationConfig = {
                temperature: 0.8, // Slightly higher for more varied emoji styles
                topP: 0.9,
                topK: 40,
                maxOutputTokens: 350, // Increased max tokens for 5 categories
            };

            const result = await this.textModel.generateContent(prompt, generationConfig);
            const response = result.response;
            const text = response.text();
            console.log('GeminiService: Raw structured emoji response received:', text);

            return this.parseStructuredEmojisResponse(text); // Use the new parser
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
     * NEW METHOD: Analyzes a list of hashtags, categorizing them using both local data and AI.
     * @param {object} params
     * @param {string[]} params.hashtags - An array of hashtags to analyze (without #).
     * @param {string} [params.captionText] - The caption context (optional, for AI nuance).
     * @param {string} [params.language='English'] - The language of the content.
     * @returns {Promise<Array<{hashtag: string, category: string, reason?: string}>>} Analyzed hashtag list.
     */
    async analyzeHashtagsAI({ hashtags, captionText = '', language = 'English' }) {
        console.log(`GeminiService: analyzeHashtagsAI called for ${hashtags.length} hashtags.`);
        if (!this.textModel) {
            throw new Error('Gemini text client not initialized. Please check your API key.');
        }

        const results = [];
        const uniqueHashtags = [...new Set(hashtags.map(tag => tag.toLowerCase()))]; // Deduplicate and lowercase

        for (const tag of uniqueHashtags) {
            // 1. Check against local Banned list
            if (this.hashtagsData.bannedHashtags.includes(tag)) {
                results.push({ hashtag: tag, category: 'banned', reason: 'Explicitly banned by platform.' });
                continue; // Move to next hashtag
            }

            // 2. Check against local Overused list
            if (this.hashtagsData.overusedHashtags.includes(tag)) {
                results.push({ hashtag: tag, category: 'overused', reason: 'Extremely popular, content may get lost quickly.' });
                continue; // Move to next hashtag
            }

            // 3. AI Analysis for others (especially new/unknown/potentially sensitive)
            try {
                const aiPrompt = this.buildHashtagAnalysisPrompt({ hashtag: tag, captionText, language });
                const generationConfig = { temperature: 0.5, topP: 0.9, topK: 40, maxOutputTokens: 100 };
                
                const result = await this.textModel.generateContent(aiPrompt, generationConfig);
                const response = result.response;
                const aiAnalysis = response.text().trim().toLowerCase(); // Get AI's raw output

                // Parse AI response into categories
                if (aiAnalysis.includes('spammy') || aiAnalysis.includes('low quality') || aiAnalysis.includes('engagement bait') || aiAnalysis.includes('generic') && aiAnalysis.includes('low quality')) {
                    results.push({ hashtag: tag, category: 'spammy/low_quality', reason: aiAnalysis });
                } else if (aiAnalysis.includes('controversial') || aiAnalysis.includes('sensitive') || aiAnalysis.includes('policy violation') || aiAnalysis.includes('misinterpreted') || aiAnalysis.includes('flagged')) {
                    results.push({ hashtag: tag, category: 'caution', reason: aiAnalysis });
                } else if (aiAnalysis.includes('niche') || aiAnalysis.includes('specific') || aiAnalysis.includes('targeted') || aiAnalysis.includes('relevant')) {
                    results.push({ hashtag: tag, category: 'safe/niche', reason: aiAnalysis });
                } else if (aiAnalysis.includes('popular') || aiAnalysis.includes('high volume') || aiAnalysis.includes('generic') && aiAnalysis.includes('broad')) {
                    results.push({ hashtag: tag, category: 'overused_ai', reason: aiAnalysis }); // AI detected as overused
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

    // AI-Powered Scheduling Assistant (remains unchanged)
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
     * @param {object} params
     * @param {string} params.originalCaption
     * @param {string} params.mood
     * @param {string} params.length
     * @param {string} params.language
     * @returns {string} The prompt string.
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
     * NEW METHOD: Builds a prompt for Gemini to analyze a single hashtag.
     * @param {object} params
     * @param {string} params.hashtag - The hashtag to analyze.
     * @param {string} [params.captionText] - The associated caption text for context.
     * @param {string} [params.language='English'] - The language of the content.
     * @returns {string} The prompt string.
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
     * NEW METHOD: Suggests Call-to-Actions (CTAs) based on content and post goal.
     * @param {object} params
     * @param {string} params.captionText - The current caption text.
     * @param {string} params.postGoal - The user's goal for the post (e.g., 'drive traffic', 'increase engagement').
     * @param {string} [params.topic] - The associated topic.
     * @param {string} [params.mood] - The associated mood.
     * @param {string} [params.persona] - The associated persona.
     * @param {string} [params.language='English'] - The desired language for the CTAs.
     * @param {string} [params.brandVoice] - The user's preferred brand voice.
     * @param {string} [params.targetAudience] - The user's target audience description.
     * @returns {Promise<string[]>} An array of suggested CTA strings.
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
                maxOutputTokens: 200, // Sufficient for a few short CTAs
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
     * @param {object} params
     * @param {string} params.captionText
     * @param {string} params.postGoal
     * @param {string} [params.topic]
     * @param {string} [params.mood]
     * @param {string} [params.persona]
     * @param {string} [params.language]
     * @param {string} [params.brandVoice]
     * @param {string} [params.targetAudience]
     * @returns {string} The constructed prompt.
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
     * @param {string} responseText - The raw text response from Gemini.
     * @returns {string[]} An array of parsed CTA strings.
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
     * @param {string} responseText - The raw text response from Gemini.
     * @returns {string[]} An array of parsed rewritten captions.
     */
    parseRewrittenCaptions(responseText) {
        console.log('GeminiService: Parsing rewritten captions response.');
        const captions = [];
        const lines = responseText.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Look for lines starting with a number followed by a period and space (e.g., "1. ")
            const match = trimmedLine.match(/^\d+\.\s*(.*)/);
            if (match && match[1]) {
                captions.push(match[1].trim());
            }
        }
        if (captions.length === 0) {
            console.warn('GeminiService: No numbered list captions found, attempting basic line parsing.');
            // Fallback: if no numbered list, just take non-empty lines as captions
            return responseText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        }
        return captions;
    }

    /**
     * Parses structured emoji suggestions from Gemini.
     * Expected format:
     * TYPE: [Category Name 1]
     * EMOJIS: [emoji1, emoji2, emoji3]
     *
     * TYPE: [Category Name 2]
     * EMOJIS: [emoji1, emoji2, emoji3]
     * @param {string} responseText - The raw text response from Gemini.
     * @returns {Array<{type: string, emojis: string[]}>} An array of objects, each with a type and an array of emojis.
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
                // Remove brackets if present, split by comma, trim, filter for actual emojis
                const emojis = emojisString
                    .replace(/^\[|\]$/g, '') // Remove leading/trailing brackets
                    .split(',')
                    .map(emoji => emoji.trim())
                    .filter(emoji => emoji.length > 0); // Filter out empty strings
                currentCategory.emojis = emojis;
                currentCategory = null; // Reset for next category
            }
        }

        if (emojiCategories.length === 0) {
            console.warn('GeminiService: Failed to parse structured emoji response. Attempting fallback for flat list.');
            // Fallback to simple comma-separated parsing if structured format fails
            const simpleEmojis = responseText.trim().replace(/['"`\n\r]/g, '').split(',').map(emoji => emoji.trim()).filter(emoji => emoji.length > 0);
            if (simpleEmojis.length > 0) {
                return [{ type: 'General Emojis', emojis: simpleEmojis }];
            }
        }

        return emojiCategories;
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
