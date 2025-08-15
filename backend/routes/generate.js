import express from 'express';
import geminiService from '../services/geminiService.js';
import database from '../db/database.js'; // Import the database service

const router = express.Router();

// Generate caption and hashtags (text-based)
router.post('/', async (req, res) => {
    console.log('Generate Route: POST / called (text-based).');
    try {
        const { topic, mood, persona, trendingTopic, language } = req.body;
        const userId = req.user.id; // User ID from authentication middleware

        console.log('Generate Route: Request body for text gen:', req.body);

        if (!topic || !mood || !persona || !language) {
            console.warn('Generate Route: Missing required fields for text generation (400).');
            return res.status(400).json({
                error: 'Topic, mood, persona, and language are required'
            });
        }
        console.log('Generate Route: Text generation request received for topic:', topic, 'in language:', language);

        // Fetch user's brand voice and target audience from the database
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;

        const generatedContent = await geminiService.generateCaptionAndHashtags({
            topic,
            mood,
            persona,
            trendingTopic,
            language,
            brandVoice,    // Pass brandVoice to Gemini service
            targetAudience // Pass targetAudience to Gemini service
        });
        console.log('Generate Route: Text generated successfully (single output).');

        res.json({
            success: true,
            ...generatedContent,
            metadata: {
                topic,
                mood,
                persona,
                trendingTopic,
                language,
                brandVoice,     // Include in metadata for client-side reference
                targetAudience, // Include in metadata for client-side reference
                generatedAt: new Date().toISOString()
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

// Generate caption and hashtags from image
router.post('/image-caption', async (req, res) => {
    console.log('Generate Route: POST /image-caption called.');
    try {
        const { image, mimeType, trendingTopic, language } = req.body;
        const userId = req.user.id; // User ID from authentication middleware

        console.log('Generate Route: Request body for image gen (partial):', { mimeType, trendingTopic, language });

        if (!image || !mimeType || !language) {
            console.warn('Generate Route: Missing image data, mimeType, or language (400).');
            return res.status(400).json({ error: 'Image data, MIME type, and language are required.' });
        }
        console.log('Generate Route: Image generation request received for mimeType:', mimeType, 'in language:', language);

        // Fetch user's brand voice and target audience from the database
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;

        const generatedContent = await geminiService.generateCaptionAndHashtagsFromImage({
            base64Image: image,
            mimeType: mimeType,
            trendingTopic: trendingTopic,
            language,
            brandVoice,    // Pass brandVoice to Gemini service
            targetAudience // Pass targetAudience to Gemini service
        });
        console.log('Generate Route: Image generated successfully (single output).');

        res.json({
            success: true,
            ...generatedContent,
            metadata: {
                topic: 'Image Analysis', // Inferred
                mood: 'Inferred',        // Inferred
                persona: 'Inferred',     // Inferred
                trendingTopic: trendingTopic,
                language,
                brandVoice,     // Include in metadata for client-side reference
                targetAudience, // Include in metadata for client-side reference
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
 * NEW ROUTE: Suggest Emojis.
 * Accepts text and context to return AI-suggested emojis.
 */
router.post('/suggest-emojis', async (req, res) => {
    console.log('Generate Route: POST /suggest-emojis called.');
    try {
        const { captionText, mood, topic, persona, language } = req.body;
        const userId = req.user.id; // Optional: for logging/rate limiting/future stats

        console.log('Generate Route: Emoji suggestion request body:', { captionText: captionText ? captionText.substring(0, 50) + '...' : '', mood, topic, persona, language });

        if (!captionText) { // Basic validation: at least captionText is needed
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
 * NEW ROUTE: Analyze Hashtags.
 * Accepts a list of hashtags and caption context for analysis (local JSON + AI).
 */
router.post('/analyze-hashtags', async (req, res) => {
    console.log('Generate Route: POST /analyze-hashtags called.');
    try {
        const { hashtags, captionText, language } = req.body;
        const userId = req.user.id; // For logging/rate limiting

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

// NEW ROUTE: Suggest CTAs
router.post('/suggest-ctas', async (req, res) => {
    console.log('Generate Route: POST /suggest-ctas called.');
    try {
        const { captionText, postGoal, topic, mood, persona, language } = req.body;
        const userId = req.user.id; // User ID from authentication middleware

        console.log('Generate Route: CTA suggestion request body:', { captionText: captionText ? captionText.substring(0, 50) + '...' : '', postGoal, topic, mood, persona, language });

        if (!captionText || !postGoal) {
            console.warn('Generate Route: Missing captionText or postGoal for CTA suggestion (400).');
            return res.status(400).json({ error: 'Caption text and post goal are required for CTA suggestions.' });
        }

        // Fetch user's brand voice and target audience from the database
        const user = await database.getUserById(userId);
        const brandVoice = user ? user.brand_voice : null;
        const targetAudience = user ? user.target_audience : null;

        const suggestedCTAs = await geminiService.suggestCTAs({
            captionText,
            postGoal,
            topic,
            mood,
            persona,
            language,
            brandVoice,    // Pass brandVoice to Gemini service
            targetAudience // Pass targetAudience to Gemini service
        });
        console.log('Generate Route: CTAs suggested successfully. Count:', suggestedCTAs.length);

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


/**
 * Save Rewritten Captions
 * Accepts a set of rewritten captions and their metadata to save to the database.
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

// These routes remain unchanged as they were not directly affected by the variations feature
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
