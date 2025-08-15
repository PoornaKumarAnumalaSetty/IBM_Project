import express from 'express';
import database from '../db/database.js';
import crypto from 'crypto'; // For generating share tokens

const router = express.Router();

// IMPORTANT: NGROK_PUBLIC_URL is now passed via req.ngrokPublicUrl from server.js
// No longer hardcoded here.

// Route to generate a new share link (requires authentication)
router.post('/generate', async (req, res) => {
    console.log('Share Route: POST /generate called.');
    try {
        const userId = req.user.id; // User must be authenticated to generate a link

        // Ensure Ngrok URL is available (it should be if initializeNgrokUrl succeeded in server.js)
        const ngrokPublicUrl = req.ngrokPublicUrl;
        if (!ngrokPublicUrl) {
            console.error('Share Route: Ngrok public URL not available on request. Share link generation failed.');
            return res.status(500).json({ error: 'Public URL not ready. Please ensure Ngrok is running and restart server if needed.' });
        }

        // Generate a unique, random share token
        const shareToken = crypto.randomBytes(20).toString('hex'); // 40-character hex string
        const expiresAt = null; // Optional: link expiration (e.g., new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) for 7 days)

        const newShareLink = await database.createShareLink(userId, shareToken, expiresAt);
        console.log('Share Route: New share link generated. ID:', newShareLink.id, 'Token (partial):', shareToken.substring(0, 10) + '...');

        // Construct the full shareable URL using the dynamically fetched Ngrok public URL
        const shareableUrl = `${ngrokPublicUrl}/share/${shareToken}`;

        res.status(201).json({
            success: true,
            message: 'Share link generated successfully!',
            shareLink: {
                id: newShareLink.id,
                share_token: newShareLink.share_token,
                shareable_url: shareableUrl,
                created_at: newShareLink.created_at,
                expires_at: newShareLink.expires_at
            }
        });

    } catch (error) {
        console.error('Share Route: Error generating share link:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Failed to generate unique link. Please try again.' });
        }
        res.status(500).json({
            error: 'Failed to generate share link',
            message: error.message
        });
    }
});

// Route to get all share links for the authenticated user
router.get('/my-links', async (req, res) => {
    console.log('Share Route: GET /my-links called.');
    try {
        const userId = req.user.id;
        const shareLinks = await database.getShareLinksByUserId(userId);
        console.log('Share Route: /my-links returned', shareLinks.length, 'links.');

        // Ensure Ngrok URL is available
        const ngrokPublicUrl = req.ngrokPublicUrl;
        if (!ngrokPublicUrl) {
            console.error('Share Route: Ngrok public URL not available on request. Cannot display share links.');
            return res.status(500).json({ error: 'Public URL not ready. Please ensure Ngrok is running and restart server if needed.' });
        }

        // For each link, construct the full shareable URL using the dynamically fetched Ngrok public URL
        const formattedLinks = shareLinks.map(link => ({
            ...link,
            shareable_url: `${ngrokPublicUrl}/share/${link.share_token}`
        }));

        res.json(formattedLinks);

    } catch (error) {
        console.error('Share Route: Error getting user share links:', error);
        res.status(500).json({
            error: 'Failed to retrieve share links',
            message: error.message
        });
    }
});

// Route to delete/deactivate a share link (requires authentication)
router.delete('/:id', async (req, res) => {
    console.log('Share Route: DELETE /:id called.');
    try {
        const shareLinkId = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(shareLinkId)) {
            return res.status(400).json({ error: 'Invalid share link ID' });
        }

        const deletedLink = await database.deleteShareLink(shareLinkId, userId);

        if (!deletedLink) {
            return res.status(404).json({ error: 'Share link not found or does not belong to you' });
        }

        res.json({
            success: true,
            message: 'Share link deactivated successfully',
            shareLink: deletedLink
        });

    } catch (error) {
        console.error('Share Route: Error deleting share link:', error);
        res.status(500).json({
            error: 'Failed to delete share link',
            message: error.message
        });
    }
});

// The public /view/:token route remains directly in server.js

export default router;