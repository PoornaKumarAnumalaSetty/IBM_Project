import express from 'express';
import database from '../db/database.js';
import geminiService from '../services/geminiService.js';

const router = express.Router();

router.post('/schedule', async (req, res) => {
    console.log('Calendar Route: POST /schedule called.');
    try {
        const { postId, scheduledDate } = req.body;
        const userId = req.user.id;

        console.log('Calendar Route: Request body for schedule:', { postId, scheduledDate });

        if (!postId || !scheduledDate) {
            console.warn('Calendar Route: Missing post ID or scheduled date (400).');
            return res.status(400).json({
                error: 'Post ID and scheduled date are required'
            });
        }

        const date = new Date(scheduledDate);
        if (isNaN(date.getTime())) {
            console.warn('Calendar Route: Invalid date format (400).');
            return res.status(400).json({
                error: 'Invalid date format'
            });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        if (date < todayStart) {
            console.warn('Calendar Route: Attempt to schedule for past date (400).');
            return res.status(400).json({
                error: 'Cannot schedule posts for past dates'
            });
        }

        const post = await database.getSavedPostById(postId, userId);
        if (!post) {
            console.warn('Calendar Route: Post not found or does not belong to user (404).');
            return res.status(404).json({
                error: 'Post not found or does not belong to you'
            });
        }

        const scheduledEvent = await database.schedulePost(userId, postId, scheduledDate);
        console.log('Calendar Route: Post scheduled successfully. Event ID:', scheduledEvent.id);

        res.status(201).json({
            success: true,
            message: 'Post scheduled successfully',
            event: scheduledEvent
        });

    } catch (error) {
        console.error('Calendar Route: Schedule post error:', error);

        if (error.code === '23505') {
            console.warn('Calendar Route: Unique constraint violation (post already scheduled for this date).');
            return res.status(400).json({
                error: 'This post is already scheduled for the selected date'
            });
        }

        res.status(500).json({
            error: 'Failed to schedule post',
            message: error.message
        });
    }
});

router.get('/suggest-time', async (req, res) => {
    console.log('Calendar Route: GET /suggest-time called.');
    try {
        const { persona, topic, audienceType, currentDayOfWeek } = req.query;

        console.log('Calendar Route: Request query for time suggestion:', req.query);

        if (!persona || !topic || !audienceType) {
            console.warn('Calendar Route: Missing required query parameters for time suggestions (400).');
            return res.status(400).json({
                error: 'Persona, Topic, and Audience Type are required for time suggestions.'
            });
        }

        console.log('Calendar Route: Requesting optimal time suggestion from GeminiService with:', { persona, topic, audienceType, currentDayOfWeek });
        const suggestedTimes = await geminiService.suggestOptimalPostingTime({
            persona,
            topic,
            audienceType,
            currentDayOfWeek: currentDayOfWeek || 'any'
        });
        console.log('Calendar Route: Received suggested times:', suggestedTimes);

        res.json({
            success: true,
            suggestedTimes: suggestedTimes
        });

    } catch (error) {
        console.error('Calendar Route: Error getting optimal time suggestions:', error);

        res.status(500).json({
            error: 'Failed to get optimal time suggestions',
            message: error.message
        });
    }
});

router.get('/scheduled', async (req, res) => {
    console.log('Calendar Route: GET /scheduled called.');
    try {
        const userId = req.user.id;
        const scheduledPosts = await database.getScheduledPosts(userId);
        console.log('Calendar Route: /scheduled returned', scheduledPosts.length, 'posts.');

        res.json(scheduledPosts);

    } catch (error) {
        console.error('Calendar Route: Get scheduled posts error:', error);
        res.status(500).json({
            error: 'Failed to get scheduled posts',
            message: error.message
        });
    }
});

router.get('/scheduled/range', async (req, res) => {
    console.log('Calendar Route: GET /scheduled/range called.');
    try {
        const userId = req.user.id;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                error: 'Start date and end date are required'
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                error: 'Invalid date format'
            });
        }

        const allScheduledPosts = await database.getScheduledPosts(userId);
        const filteredPosts = allScheduledPosts.filter(post => {
            const postDate = new Date(post.scheduled_date);
            return postDate >= start && postDate <= end;
        });

        res.json(filteredPosts);

    } catch (error) {
        console.error('Calendar Route: Get scheduled posts by range error:', error);
        res.status(500).json({
            error: 'Failed to get scheduled posts',
            message: error.message
        });
    }
});

router.delete('/scheduled/:id', async (req, res) => {
    console.log('Calendar Route: DELETE /scheduled/:id called.');
    try {
        const eventId = parseInt(req.params.id);
        const userId = req.user.id;

        if (isNaN(eventId)) {
            return res.status(400).json({ error: 'Invalid event ID' });
        }

        const deletedEvent = await database.unschedulePost(eventId, userId);

        if (!deletedEvent) {
            return res.status(404).json({ error: 'Scheduled event not found' });
        }

        res.json({
            success: true,
            message: 'Post unscheduled successfully',
            event: deletedEvent
        });

    } catch (error) {
        console.error('Calendar Route: Unschedule post error:', error);
        res.status(500).json({
            error: 'Failed to unschedule post',
            message: error.message
        });
    }
});

router.get('/upcoming', async (req, res) => {
    console.log('Calendar Route: GET /upcoming called.');
    try {
        const userId = req.user.id;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);

        const allScheduledPosts = await database.getScheduledPosts(userId);
        const upcomingPosts = allScheduledPosts.filter(post => {
            const postDate = new Date(post.scheduled_date);
            return postDate >= today && postDate <= nextWeek;
        }).sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date));

        res.json(upcomingPosts);

    } catch (error) {
        console.error('Calendar Route: Get upcoming posts error:', error);
        res.status(500).json({
            error: 'Failed to get upcoming posts',
            message: error.message
        });
    }
});

export default router;