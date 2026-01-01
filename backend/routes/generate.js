import express from 'express';
import geminiService from '../services/geminiService.js';
import database from '../db/database.js';
import userPreferenceService from '../services/userPreferenceService.js';
import geminiMemoryEngine from '../services/geminiMemoryEngine.js';
import captionHistoryService from '../services/captionHistoryService.js';

const router = express.Router();

// ========== ADVANCED BRAND VOICE ENGINE ENDPOINTS ==========

/**
 * Analyze content to extract voice characteristics for ML training
 */
router.post('/analyze-voice', async (req, res) => {
    console.log('Generate Route: POST /analyze-voice called.');
    try {
        const { contentText, contentType, language = 'English' } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Voice analysis request for content type:', contentType);

        if (!contentText || !contentType) {
            console.warn('Generate Route: Missing contentText or contentType for voice analysis (400).');
            return res.status(400).json({
                error: 'Content text and content type are required for voice analysis'
            });
        }

        const voiceAnalysis = await geminiService.analyzeContentVoice({
            contentText,
            contentType,
            language
        });

        console.log('Generate Route: Voice analysis completed successfully.');

        // Store the analysis in database for ML training
        await database.storeContentAnalysis(userId, {
            contentType,
            contentText,
            ...voiceAnalysis
        });

        res.json({
            success: true,
            analysis: voiceAnalysis,
            metadata: {
                contentType,
                language,
                analyzedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Voice analysis error:', error);
        res.status(500).json({
            error: 'Failed to analyze voice characteristics',
            message: error.message
        });
    }
});

/**
 * Create or update brand voice profile
 */
router.post('/create-voice-profile', async (req, res) => {
    console.log('Generate Route: POST /create-voice-profile called.');
    try {
        const { 
            profileName = 'Default Profile',
            formality = 0.5,
            humor = 0.5,
            enthusiasm = 0.5,
            professionalism = 0.5,
            creativity = 0.5,
            emotionalTone = 0.5,
            confidence = 0.5,
            warmth = 0.5
        } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Creating/updating voice profile for user:', userId);

        const voiceProfile = await database.upsertVoiceProfile(userId, {
            profileName,
            formality,
            humor,
            enthusiasm,
            professionalism,
            creativity,
            emotionalTone,
            confidence,
            warmth
        });

        console.log('Generate Route: Voice profile created/updated successfully. ID:', voiceProfile.id);

        res.json({
            success: true,
            voiceProfile,
            message: 'Voice profile saved successfully'
        });

    } catch (error) {
        console.error('Generate Route: Create voice profile error:', error);
        res.status(500).json({
            error: 'Failed to create voice profile',
            message: error.message
        });
    }
});

/**
 * Get user's voice profiles
 */
router.get('/voice-profiles', async (req, res) => {
    console.log('Generate Route: GET /voice-profiles called.');
    try {
        const userId = req.user.id;
        const voiceProfile = await database.getVoiceProfile(userId);

        console.log('Generate Route: Retrieved voice profile for user:', userId);

        res.json({
            success: true,
            voiceProfile: voiceProfile || null
        });

    } catch (error) {
        console.error('Generate Route: Get voice profiles error:', error);
        res.status(500).json({
            error: 'Failed to retrieve voice profiles',
            message: error.message
        });
    }
});

/**
 * Get specific voice profile by ID
 */
router.get('/voice-profiles/:id', async (req, res) => {
    console.log('Generate Route: GET /voice-profiles/:id called.');
    try {
        // Note: Currently users have one active profile, but keeping structure for future expansion
        const userId = req.user.id;
        const voiceProfile = await database.getVoiceProfile(userId);

        if (!voiceProfile) {
            return res.status(404).json({ error: 'Voice profile not found' });
        }

        res.json({
            success: true,
            voiceProfile
        });

    } catch (error) {
        console.error('Generate Route: Get voice profile by ID error:', error);
        res.status(500).json({
            error: 'Failed to retrieve voice profile',
            message: error.message
        });
    }
});

/**
 * Update voice profile
 */
router.put('/voice-profiles/:id', async (req, res) => {
    console.log('Generate Route: PUT /voice-profiles/:id called.');
    try {
        const userId = req.user.id;
        const updates = req.body;

        console.log('Generate Route: Updating voice profile with:', updates);

        const voiceProfile = await database.upsertVoiceProfile(userId, updates);

        res.json({
            success: true,
            voiceProfile,
            message: 'Voice profile updated successfully'
        });

    } catch (error) {
        console.error('Generate Route: Update voice profile error:', error);
        res.status(500).json({
            error: 'Failed to update voice profile',
            message: error.message
        });
    }
});

/**
 * Collect user feedback for ML training
 */
router.post('/voice-feedback', async (req, res) => {
    console.log('Generate Route: POST /voice-feedback called.');
    try {
        const {
            generatedContentId,
            contentType,
            feedbackType,
            feedbackComment,
            expectedFormality,
            expectedHumor,
            expectedEnthusiasm,
            expectedProfessionalism,
            expectedCreativity,
            expectedEmotionalTone,
            expectedConfidence,
            expectedWarmth
        } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Storing voice feedback for content type:', contentType);

        if (!contentType || !feedbackType) {
            console.warn('Generate Route: Missing contentType or feedbackType for voice feedback (400).');
            return res.status(400).json({
                error: 'Content type and feedback type are required'
            });
        }

        const feedback = await database.storeVoiceFeedback(userId, {
            generatedContentId,
            contentType,
            feedbackType,
            feedbackComment,
            expectedFormality,
            expectedHumor,
            expectedEnthusiasm,
            expectedProfessionalism,
            expectedCreativity,
            expectedEmotionalTone,
            expectedConfidence,
            expectedWarmth
        });

        console.log('Generate Route: Voice feedback stored successfully. ID:', feedback.id);

        // Trigger ML refinement if enough feedback is collected
        await triggerVoiceRefinement(userId);

        res.json({
            success: true,
            feedback,
            message: 'Feedback recorded successfully'
        });

    } catch (error) {
        console.error('Generate Route: Voice feedback error:', error);
        res.status(500).json({
            error: 'Failed to store voice feedback',
            message: error.message
        });
    }
});

/**
 * Get content analysis insights
 */
router.get('/content-analysis', async (req, res) => {
    console.log('Generate Route: GET /content-analysis called.');
    try {
        const userId = req.user.id;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;

        const analysisHistory = await database.getContentAnalysisHistory(userId, limit);
        const feedbackHistory = await database.getVoiceFeedbackHistory(userId, limit);

        console.log('Generate Route: Retrieved analysis history:', analysisHistory.length, 'records');

        // Calculate average voice characteristics
        const voiceSummary = calculateVoiceSummary(analysisHistory);

        res.json({
            success: true,
            analysisHistory,
            feedbackHistory,
            voiceSummary,
            metadata: {
                totalAnalysis: analysisHistory.length,
                totalFeedback: feedbackHistory.length,
                retrievedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Get content analysis error:', error);
        res.status(500).json({
            error: 'Failed to retrieve content analysis',
            message: error.message
        });
    }
});

/**
 * Validate content consistency against voice profile
 */
router.post('/validate-consistency', async (req, res) => {
    console.log('Generate Route: POST /validate-consistency called.');
    try {
        const { contentText, contentType = 'caption', language = 'English' } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Validating content consistency for type:', contentType);

        if (!contentText) {
            console.warn('Generate Route: Missing contentText for consistency validation (400).');
            return res.status(400).json({
                error: 'Content text is required for consistency validation'
            });
        }

        // Get user's voice profile
        const voiceProfile = await database.getVoiceProfile(userId);
        
        if (!voiceProfile) {
            return res.status(404).json({
                error: 'No voice profile found. Please create a voice profile first.'
            });
        }

        // Analyze the content
        const contentAnalysis = await geminiService.analyzeContentVoice({
            contentText,
            contentType,
            language
        });

        // Calculate consistency score
        const consistencyScore = calculateConsistencyScore(voiceProfile, contentAnalysis);

        res.json({
            success: true,
            consistency: {
                score: consistencyScore,
                profile: voiceProfile,
                contentAnalysis,
                recommendations: generateConsistencyRecommendations(voiceProfile, contentAnalysis)
            },
            metadata: {
                contentType,
                validatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Validate consistency error:', error);
        res.status(500).json({
            error: 'Failed to validate content consistency',
            message: error.message
        });
    }
});

// ========== ENHANCED EXISTING ENDPOINTS WITH VOICE PROFILE SUPPORT ==========

// Generate caption and hashtags (text-based) - ENHANCED
router.post('/', async (req, res) => {
    console.log('Generate Route: POST / called (text-based with advanced voice).');
    try {
        const { topic, mood, persona, trendingTopic, language, voiceProfileId } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Request body for text gen:', req.body);

        if (!topic || !mood || !persona || !language) {
            console.warn('Generate Route: Missing required fields for text generation (400).');
            return res.status(400).json({
                error: 'Topic, mood, persona, and language are required'
            });
        }

        console.log('Generate Route: Text generation request received for topic:', topic, 'in language:', language);

        // Fetch user's data including voice profile
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;
        
        // Get advanced voice profile if available
        const voiceProfile = await database.getVoiceProfile(userId);

        const userPreferences = await userPreferenceService.getPreferences(userId);
        const memoryPreferences = {
            ...userPreferences,
            language_preference: userPreferences.language_preference || language
        };

        const generatedContent = await geminiService.generateCaptionAndHashtags({
            topic,
            mood,
            persona,
            trendingTopic,
            language,
            brandVoice,
            voiceProfile,    // Pass advanced voice profile
            targetAudience,
            userPreferences: memoryPreferences
        });

        console.log('Generate Route: Text generated successfully with voice profile integration.');

        // Analyze and store the generated content for ML training
        try {
            const contentAnalysis = await geminiService.analyzeContentVoice({
                contentText: generatedContent.caption,
                contentType: 'caption',
                language
            });
            
            await database.storeContentAnalysis(userId, {
                contentType: 'caption',
                contentText: generatedContent.caption,
                ...contentAnalysis
            });
        } catch (analysisError) {
            console.warn('Generate Route: Content analysis failed (non-critical):', analysisError.message);
        }

        let updatedPreferences = memoryPreferences;
        try {
            const learnedPrefs = await geminiMemoryEngine.learnFromCaption(userId, generatedContent.caption, { language });
            if (learnedPrefs) {
                updatedPreferences = await userPreferenceService.updatePreferences(userId, learnedPrefs);
            }
        } catch (memoryError) {
            console.warn('Generate Route: Memory engine update failed (non-critical):', memoryError.message);
        }

        let historyEntry = null;
        try {
            historyEntry = await captionHistoryService.saveEntry({
                userId,
                generatedCaption: generatedContent.caption,
                finalCaption: generatedContent.caption,
                feedbackScore: 5
            });
        } catch (historyError) {
            console.warn('Generate Route: Caption history save failed (non-critical):', historyError.message);
        }

        res.json({
            success: true,
            ...generatedContent,
            memorySnapshot: updatedPreferences,
            metadata: {
                topic,
                mood,
                persona,
                trendingTopic,
                language,
                brandVoice,
                targetAudience,
                voiceProfileUsed: !!voiceProfile,
                generatedAt: new Date().toISOString(),
                generatedContentId: historyEntry?.id || null
            }
        });

    } catch (error) {
        console.error('Generate Route: Generation error (Text-based):', error);
        res.status(500).json({
            error: 'Failed to generate content',
            message: error.message
        });
    }
});

// Generate caption and hashtags from image - ENHANCED
router.post('/image-caption', async (req, res) => {
    console.log('Generate Route: POST /image-caption called (with advanced voice).');
    try {
        const { image, mimeType, trendingTopic, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Request body for image gen (partial):', { mimeType, trendingTopic, language });

        if (!image || !mimeType || !language) {
            console.warn('Generate Route: Missing image data, mimeType, or language (400).');
            return res.status(400).json({ 
                error: 'Image data, MIME type, and language are required.' 
            });
        }

        console.log('Generate Route: Image generation request received for mimeType:', mimeType, 'in language:', language);

        // Fetch user's data including voice profile
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;
        
        // Get advanced voice profile if available
        const voiceProfile = await database.getVoiceProfile(userId);

        const generatedContent = await geminiService.generateCaptionAndHashtagsFromImage({
            base64Image: image,
            mimeType: mimeType,
            trendingTopic: trendingTopic,
            language,
            brandVoice,
            voiceProfile,    // Pass advanced voice profile
            targetAudience
        });

        console.log('Generate Route: Image generated successfully with voice profile integration.');

        // Analyze and store the generated content for ML training
        try {
            const contentAnalysis = await geminiService.analyzeContentVoice({
                contentText: generatedContent.caption,
                contentType: 'caption',
                language
            });
            
            await database.storeContentAnalysis(userId, {
                contentType: 'caption',
                contentText: generatedContent.caption,
                ...contentAnalysis
            });
        } catch (analysisError) {
            console.warn('Generate Route: Content analysis failed (non-critical):', analysisError.message);
        }

        res.json({
            success: true,
            ...generatedContent,
            metadata: {
                topic: 'Image Analysis',
                mood: 'Inferred',
                persona: 'Inferred',
                trendingTopic: trendingTopic,
                language,
                brandVoice,
                targetAudience,
                voiceProfileUsed: !!voiceProfile,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Generation error (Image-based):', error);
        res.status(500).json({
            error: 'Failed to generate content from image',
            message: error.message
        });
    }
});

// Suggest CTAs - ENHANCED
router.post('/suggest-ctas', async (req, res) => {
    console.log('Generate Route: POST /suggest-ctas called (with advanced voice).');
    try {
        const { captionText, postGoal, topic, mood, persona, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: CTA suggestion request body:', { captionText: captionText ? captionText.substring(0, 50) + '...' : '', postGoal, topic, mood, persona, language });

        if (!captionText || !postGoal) {
            console.warn('Generate Route: Missing captionText or postGoal for CTA suggestion (400).');
            return res.status(400).json({ error: 'Caption text and post goal are required for CTA suggestions.' });
        }

        // Fetch user's data including voice profile
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;
        
        // Get advanced voice profile if available
        const voiceProfile = await database.getVoiceProfile(userId);

        const suggestedCTAs = await geminiService.suggestCTAs({
            captionText,
            postGoal,
            topic,
            mood,
            persona,
            language,
            brandVoice,
            voiceProfile,    // Pass advanced voice profile
            targetAudience
        });

        console.log('Generate Route: CTAs suggested successfully with voice profile. Count:', suggestedCTAs.length);

        res.json({
            success: true,
            ctas: suggestedCTAs,
            metadata: {
                captionText,
                postGoal,
                topic,
                mood,
                persona,
                language,
                brandVoice,
                targetAudience,
                voiceProfileUsed: !!voiceProfile,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: CTA suggestion error:', error);
        res.status(500).json({
            error: 'Failed to suggest CTAs',
            message: error.message
        });
    }
});

// ========== HELPER FUNCTIONS ==========

/**
 * Trigger voice profile refinement based on collected data
 */
async function triggerVoiceRefinement(userId) {
    try {
        // Get recent analysis and feedback
        const analysisHistory = await database.getContentAnalysisHistory(userId, 20);
        const feedbackHistory = await database.getVoiceFeedbackHistory(userId, 10);
        
        if (analysisHistory.length < 5) {
            console.log('Voice Engine: Not enough data for refinement yet.');
            return;
        }

        const currentProfile = await database.getVoiceProfile(userId);
        
        if (!currentProfile) {
            console.log('Voice Engine: No current profile to refine.');
            return;
        }

        console.log('Voice Engine: Triggering ML refinement with', analysisHistory.length, 'samples');

        const refinedProfile = await geminiService.refineVoiceProfile({
            contentAnalysis: analysisHistory,
            userFeedback: feedbackHistory,
            currentProfile
        });

        // Update the voice profile with refined values
        await database.upsertVoiceProfile(userId, refinedProfile);

        // Record training session
        await database.recordTrainingSession(userId, {
            trainingType: 'feedback_based',
            samplesUsed: analysisHistory.length,
            accuracyScore: calculateRefinementAccuracy(currentProfile, refinedProfile),
            trainingDuration: Math.floor(Math.random() * 30) + 10 // Simulated duration
        });

        console.log('Voice Engine: Profile refinement completed successfully');

    } catch (error) {
        console.error('Voice Engine: Refinement error:', error);
    }
}

/**
 * Calculate consistency score between voice profile and content analysis
 */
function calculateConsistencyScore(voiceProfile, contentAnalysis) {
    const dimensions = ['formality', 'humor', 'enthusiasm', 'professionalism', 'creativity', 'emotional_tone', 'confidence', 'warmth'];
    let totalScore = 0;

    dimensions.forEach(dimension => {
        const profileValue = voiceProfile[dimension];
        const contentValue = contentAnalysis[dimension];
        const difference = Math.abs(profileValue - contentValue);
        const dimensionScore = Math.max(0, 1 - difference); // 1 - difference gives higher score for smaller differences
        totalScore += dimensionScore;
    });

    return Math.round((totalScore / dimensions.length) * 100) / 100; // Average and round to 2 decimal places
}

/**
 * Calculate average voice characteristics from analysis history
 */
function calculateVoiceSummary(analysisHistory) {
    if (analysisHistory.length === 0) return null;

    const dimensions = ['formality', 'humor', 'enthusiasm', 'professionalism', 'creativity', 'emotional_tone', 'confidence', 'warmth'];
    const summary = {};

    dimensions.forEach(dimension => {
        const values = analysisHistory.map(analysis => analysis[`analyzed_${dimension}`] || analysis[dimension]).filter(val => val !== undefined);
        if (values.length > 0) {
            summary[dimension] = values.reduce((sum, val) => sum + val, 0) / values.length;
        }
    });

    return summary;
}

/**
 * Generate consistency recommendations
 */
function generateConsistencyRecommendations(voiceProfile, contentAnalysis) {
    const recommendations = [];
    const threshold = 0.3; // 30% difference threshold

    const dimensions = [
        { key: 'formality', profileLabel: 'Formality', contentLabel: 'Formal' },
        { key: 'humor', profileLabel: 'Humor', contentLabel: 'Humorous' },
        { key: 'enthusiasm', profileLabel: 'Enthusiasm', contentLabel: 'Enthusiastic' },
        { key: 'professionalism', profileLabel: 'Professionalism', contentLabel: 'Professional' },
        { key: 'creativity', profileLabel: 'Creativity', contentLabel: 'Creative' },
        { key: 'emotional_tone', profileLabel: 'Emotional Tone', contentLabel: 'Emotional' },
        { key: 'confidence', profileLabel: 'Confidence', contentLabel: 'Confident' },
        { key: 'warmth', profileLabel: 'Warmth', contentLabel: 'Warm' }
    ];

    dimensions.forEach(({ key, profileLabel, contentLabel }) => {
        const profileValue = voiceProfile[key];
        const contentValue = contentAnalysis[key];
        const difference = Math.abs(profileValue - contentValue);

        if (difference > threshold) {
            const direction = contentValue > profileValue ? 'more' : 'less';
            recommendations.push({
                dimension: profileLabel,
                difference: Math.round(difference * 100),
                suggestion: `Consider making the content ${direction} ${contentLabel.toLowerCase()} to better match your brand voice`
            });
        }
    });

    return recommendations;
}

/**
 * Calculate refinement accuracy (placeholder implementation)
 */
function calculateRefinementAccuracy(oldProfile, newProfile) {
    // Simple accuracy calculation based on profile changes
    // In a real system, this would be based on user feedback and engagement metrics
    const changes = Math.abs(newProfile.formality - oldProfile.formality) +
                   Math.abs(newProfile.humor - oldProfile.humor) +
                   Math.abs(newProfile.enthusiasm - oldProfile.enthusiasm);
    
    return Math.max(0.7, 1 - changes); // Base accuracy with some variation
}

// ========== EXISTING ROUTES (UNCHANGED) ==========

// ... (Keep all your existing routes below exactly as they are - rewrite-caption, suggest-emojis, analyze-hashtags, save-rewritten, rewritten-sets, delete rewritten-sets, save, saved, saved/:id, delete saved/:id, stats)

/**
 * AI Caption Rewriter endpoint.
 * Accepts an existing caption, desired mood, and length to return rewritten versions.
 */
router.post('/rewrite-caption', async (req, res) => {
    console.log('Generate Route: POST /rewrite-caption called.');
    try {
        const { originalCaption, mood, length, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Request body for caption rewrite:', { originalCaption: originalCaption ? originalCaption.substring(0, 50) + '...' : '', mood, length, language });

        if (!originalCaption || !mood || !length) {
            console.warn('Generate Route: Missing originalCaption, mood, or length for rewrite (400).');
            return res.status(400).json({
                error: 'Original caption, mood, and length are required for rewriting.'
            });
        }

        console.log('Generate Route: Caption rewrite request received.');

        const rewrittenCaptions = await geminiService.rewriteCaption({
            originalCaption,
            mood,
            length,
            language
        });
        console.log('Generate Route: Caption rewritten successfully. Suggestions count:', rewrittenCaptions.length);

        res.json({
            success: true,
            suggestions: rewrittenCaptions,
            metadata: {
                originalCaption,
                mood,
                length,
                language,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Caption rewrite error:', error);
        res.status(500).json({
            error: 'Failed to rewrite caption',
            message: error.message
        });
    }
});

/**
 * Suggest Emojis.
 * Accepts text and context to return AI-suggested emojis.
 */
router.post('/suggest-emojis', async (req, res) => {
    console.log('Generate Route: POST /suggest-emojis called.');
    try {
        const { captionText, mood, topic, persona, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Emoji suggestion request body:', { captionText: captionText ? captionText.substring(0, 50) + '...' : '', mood, topic, persona, language });

        if (!captionText) {
            console.warn('Generate Route: Missing captionText for emoji suggestion (400).');
            return res.status(400).json({
                error: 'Caption text is required for emoji suggestions.'
            });
        }

        const suggestedEmojis = await geminiService.suggestEmojis({
            captionText,
            mood,
            topic,
            persona,
            language
        });
        console.log('Generate Route: Emojis suggested successfully. Count:', suggestedEmojis.length);

        res.json({
            success: true,
            emojis: suggestedEmojis,
            metadata: {
                captionText,
                mood,
                topic,
                persona,
                language,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Emoji suggestion error:', error);
        res.status(500).json({
            error: 'Failed to suggest emojis',
            message: error.message
        });
    }
});

/**
 * Analyze Hashtags.
 * Accepts a list of hashtags and caption context for analysis (local JSON + AI).
 */
router.post('/analyze-hashtags', async (req, res) => {
    console.log('Generate Route: POST /analyze-hashtags called.');
    try {
        const { hashtags, captionText, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Hashtag analysis request received for hashtags:', hashtags.length);

        if (!hashtags || !Array.isArray(hashtags) || hashtags.length === 0) {
            console.warn('Generate Route: Missing or invalid hashtags for analysis (400).');
            return res.status(400).json({ error: 'An array of hashtags is required for analysis.' });
        }

        const analysisResults = await geminiService.analyzeHashtagsAI({
            hashtags,
            captionText,
            language
        });
        console.log('Generate Route: Hashtag analysis completed.');

        res.json({
            success: true,
            analysis: analysisResults,
            metadata: {
                analyzedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Generate Route: Hashtag analysis error:', error);
        res.status(500).json({
            error: 'Failed to analyze hashtags',
            message: error.message
        });
    }
});

/**
 * Save Rewritten Captions
 */
router.post('/save-rewritten', async (req, res) => {
    console.log('Generate Route: POST /save-rewritten called.');
    try {
        const { originalCaption, mood, length, language, suggestions } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Save rewritten payload received:', {
            originalCaption: originalCaption ? originalCaption.substring(0, 50) + '...' : '',
            mood,
            length,
            language,
            suggestionsCount: suggestions ? suggestions.length : 0
        });

        if (!originalCaption || !mood || !length || !language || !suggestions || !Array.isArray(suggestions) || suggestions.length === 0) {
            console.warn('Generate Route: Missing/invalid data for saving rewritten captions (400).');
            return res.status(400).json({
                error: 'Original caption, mood, length, language, and at least one suggestion are required to save rewritten captions.'
            });
        }

        const metadata = { originalCaption, mood, length, language };
        const savedSet = await database.saveRewrittenCaptions(userId, metadata, suggestions);
        console.log('Generate Route: Rewritten captions set saved to DB successfully. Set ID:', savedSet.id);

        res.status(201).json({
            success: true,
            message: 'Rewritten captions saved successfully',
            setId: savedSet.id
        });

    } catch (error) {
        console.error('Generate Route: Save rewritten captions error:', error);
        res.status(500).json({
            error: 'Failed to save rewritten captions',
            message: error.message
        });
    }
});

/**
 * Get all saved rewritten caption sets for the current user.
 */
router.get('/rewritten-sets', async (req, res) => {
    console.log('Generate Route: GET /rewritten-sets called.');
    try {
        const userId = req.user.id;
        const rewrittenSets = await database.getRewrittenCaptionSets(userId);
        console.log('Generate Route: /rewritten-sets returned', rewrittenSets.length, 'sets.');
        res.json(rewrittenSets);
    } catch (error) {
        console.error('Generate Route: Error getting rewritten sets:', error);
        res.status(500).json({
            error: 'Failed to retrieve rewritten caption sets',
            message: error.message
        });
    }
});

/**
 * Delete a specific rewritten caption set.
 */
router.delete('/rewritten-sets/:id', async (req, res) => {
    console.log('Generate Route: DELETE /rewritten-sets/:id called.');
    try {
        const setId = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(setId)) {
            return res.status(400).json({ error: 'Invalid set ID' });
        }

        const deletedSet = await database.deleteRewrittenSet(setId, userId);

        if (!deletedSet) {
            return res.status(404).json({ error: 'Rewritten set not found or you do not have permission to delete it.' });
        }

        res.json({
            success: true,
            message: 'Rewritten caption set deleted successfully',
            setId: deletedSet.id
        });

    } catch (error) {
        console.error('Generate Route: Error deleting rewritten set:', error);
        res.status(500).json({
            error: 'Failed to delete rewritten set',
            message: error.message
        });
    }
});

// Save generated post (original text/image generation)
router.post('/save', async (req, res) => {
    console.log('Generate Route: POST /save called.');
    try {
        const { topic, mood, persona, trendingTopic, caption, hashtags, language } = req.body;
        const userId = req.user.id;

        console.log('Generate Route: Save payload received:', { topic, mood, persona, trendingTopic, language, caption: caption ? caption.substring(0, 50) + '...' : '', hashtags: hashtags ? hashtags.length : 0 });

        if (!topic || !mood || !persona || !caption || !hashtags || !language) {
            console.warn('Generate Route: Missing/invalid data for saving post (400).');
            return res.status(400).json({
                error: 'All post data (including language) is required to save'
            });
        }

        const savedPost = await database.savePost(userId, {
            topic,
            mood,
            persona,
            trendingTopic,
            caption,
            hashtags,
            language
        });
        console.log('Generate Route: Post saved to DB successfully. ID:', savedPost.id);

        res.status(201).json({
            success: true,
            message: 'Post saved successfully',
            post: savedPost
        });

    } catch (error) {
        console.error('Generate Route: Save post error:', error);
        res.status(500).json({
            error: 'Failed to save post',
            message: error.message
        });
    }
});

// These routes remain unchanged
router.get('/saved', async (req, res) => {
    console.log('Generate Route: GET /saved called.');
    try {
        const userId = req.user.id;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;

        const savedPosts = await database.getSavedPosts(userId, limit);
        console.log('Generate Route: /saved returned', savedPosts.length, 'posts.');

        res.json(savedPosts);

    } catch (error) {
        console.error('Generate Route: Get saved posts error:', error);
        res.status(500).json({
            error: 'Failed to get saved posts',
            message: error.message
        });
    }
});

router.get('/saved/:id', async (req, res) => {
    console.log('Generate Route: GET /saved/:id called.');
    try {
        const postId = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(postId)) {
            return res.status(400).json({ error: 'Invalid post ID' });
        }

        const post = await database.getSavedPostById(postId, userId);

        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json(post);

    } catch (error) {
        console.error('Generate Route: Get saved post by ID error:', error);
        res.status(500).json({
            error: 'Failed to get post',
            message: error.message
        });
    }
});

router.delete('/saved/:id', async (req, res) => {
    console.log('Generate Route: DELETE /saved/:id called.');
    try {
        const postId = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(postId)) {
            return res.status(400).json({ error: 'Invalid post ID' });
        }

        const deletedPost = await database.deleteSavedPost(postId, userId);

        if (!deletedPost) {
            return res.status(404).json({ error: 'Post not found' });
        }

        res.json({
            success: true,
            message: 'Post deleted successfully',
            post: deletedPost
        });

    } catch (error) {
        console.error('Generate Route: Delete post error:', error);
        res.status(500).json({
            error: 'Failed to delete post',
            message: error.message
        });
    }
});

router.get('/stats', async (req, res) => {
    console.log('Generate Route: GET /stats called (enhanced).');
    try {
        const userId = req.user.id;
        const stats = await database.getUserStats(userId);
        console.log('Generate Route: /stats returned enhanced stats.');

        res.json(stats);

    } catch (error) {
        console.error('Generate Route: Get stats error (enhanced):', error);
        res.status(500).json({
            error: 'Failed to get statistics',
            message: error.message
        });
    }
});

export default router;