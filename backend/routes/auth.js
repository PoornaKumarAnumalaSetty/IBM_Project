import express from 'express';
import bcrypt from 'bcryptjs'; // Using bcryptjs as per your provided code
import database from '../db/database.js';
import authService from '../services/authService.js';
import { EmailService } from '../services/emailService.js';
import crypto from 'crypto'; // Not directly used in this snippet, but kept for context

const router = express.Router();
const emailService = new EmailService();

// Register new user (now sends OTP)
router.post('/register', async (req, res) => {
    try {
        const { username, email, password, confirmPassword } = req.body;
        console.log('Auth Route: Register attempt for email:', email);

        // Validate passwords match
        if (password !== confirmPassword) {
            console.warn('Auth Route: Registration failed - Passwords do not match for', email);
            return res.status(400).json({ error: 'Passwords do not match' });
        }

        // Basic validation for empty fields
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Username, email, and password are required.' });
        }

        // Check if user already exists
        let user = await database.getUserByEmail(email);
        if (user) {
            // If user exists but is not verified, allow resending OTP
            if (!user.is_verified) {
                console.log('Auth Route: User exists but unverified. Attempting to resend OTP for:', email);
                // Generate a new OTP
                const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
                const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes

                await database.setOtpCode(user.id, otpCode, otpExpires);
                await emailService.sendOtpEmail(user.email, otpCode);

                return res.status(200).json({
                    success: true,
                    message: 'Account already exists but is unverified. A new OTP has been sent to your email for verification.'
                });
            } else {
                console.warn('Auth Route: Registration failed - User already exists and is verified for', email);
                return res.status(409).json({ error: 'User with that email already exists and is already verified.' });
            }
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create new user in DB (initially unverified)
        const newUser = await database.createUser(username, email, passwordHash);

        // Generate OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
        const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes

        // Store OTP in the database
        await database.setOtpCode(newUser.id, otpCode, otpExpires);
        console.log('Auth Route: OTP set for user:', newUser.id);

        // Send OTP email
        await emailService.sendOtpEmail(newUser.email, otpCode);
        console.log(`Auth Route: OTP email sent to ${newUser.email}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please check your email for the OTP to verify your account.'
        });
    } catch (error) {
        console.error('Auth Route: Registration error for', req.body.email, ':', error);
        res.status(500).json({ error: 'Failed to register user', message: error.message });
    }
});

// Login user (checks for verification)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('Auth Route: Login attempt for email:', email);

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await database.getUserByEmail(email);
        if (!user) {
            console.warn('Auth Route: Login failed - User not found for email:', email);
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Check if email is verified
        if (!user.is_verified) {
            console.warn('Auth Route: Login failed - Email not verified for user:', user.id);
            return res.status(403).json({ error: 'Please verify your email address to log in.' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            console.warn('Auth Route: Login failed - Invalid password for user:', user.id);
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // --- CRITICAL CHANGE HERE ---
        // Call updateSession and wait for its callback before sending response
        authService.updateSession(req, user, (err) => { // Passing a callback to updateSession
            if (err) {
                console.error('Auth Route: Error saving session after login:', err);
                return res.status(500).json({ error: 'Failed to save session after login.' });
            }
            console.log('Auth Route: Login successful. Session updated for user:', user.id);
            console.log('Auth Route: Current session ID:', req.sessionID);

            res.json({
                success: true,
                message: 'Login successful',
                user: { 
                    id: user.id, 
                    username: user.username, 
                    email: user.email, 
                    is_verified: user.is_verified,
                    brand_voice: user.brand_voice, // Include new fields
                    target_audience: user.target_audience // Include new fields
                }
            });
        });
        // --- END CRITICAL CHANGE ---

    } catch (error) {
        console.error('Auth Route: Login error for', req.body.email, ':', error);
        // Ensure response is only sent once. If updateSession callback handles it, don't send here.
        // This catch block will handle errors from database.getUserByEmail or bcrypt.compare
        if (!res.headersSent) { // Check if response has already been sent
            res.status(500).json({ error: 'Failed to log in', message: error.message });
        }
    }
});

// NEW ROUTE: Verify OTP
router.post('/verify-otp', async (req, res) => {
    const { email, otpCode } = req.body;
    console.log('Auth Route: OTP verification attempt for email:', email, 'with OTP:', otpCode);

    if (!email || !otpCode) {
        return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    try {
        const user = await database.getUserByOtpCode(email, otpCode);

        if (!user) {
            console.warn('Auth Route: OTP verification failed - Invalid or expired OTP for email:', email);
            return res.status(400).json({ error: 'Invalid or expired OTP code.' });
        }

        // Mark user as verified and clear OTP
        await database.markUserAsVerified(user.id);
        console.log('Auth Route: User email verified successfully for user:', user.id);

        res.json({
            success: true,
            message: 'Email verified successfully! You can now log in.'
        });
    } catch (error) {
        console.error('Auth Route: OTP verification error for email', email, ':', error);
        res.status(500).json({ error: 'Failed to verify OTP', message: error.message });
    }
});

// Logout user
router.post('/logout', (req, res) => {
    const userIdToLog = req.session?.userId || 'unknown';
    authService.clearSession(req); // clearSession also uses req.session.destroy callback internally
    console.log('Auth Route: Logout initiated for user:', userIdToLog);
    res.json({ message: 'Logout successful' });
});

// Check authentication status
router.get('/check', async (req, res) => {
    try {
        console.log('Auth Route: Checking authentication status...');
        if (!authService.isAuthenticated(req)) {
            console.log('Auth Route: Not authenticated (isAuthenticated returned false)');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Direct call to database.getUserById to fetch user data
        // This will now include brand_voice and target_audience due to database.js update
        const user = await database.getUserById(req.session.userId); 
        if (!user) {
            console.warn('Auth Route: Authenticated session found, but user not in DB. Clearing session.');
            authService.clearSession(req); // Clear session if user somehow doesn't exist
            return res.status(401).json({ error: 'User not found, re-authenticate.' });
        }

        console.log('Auth Route: Authenticated as user:', user.id, 'Verified:', user.is_verified);

        res.json({
            authenticated: true,
            user: { 
                id: user.id, 
                username: user.username, 
                email: user.email, 
                is_verified: user.is_verified,
                brand_voice: user.brand_voice, // Include new fields
                target_audience: user.target_audience // Include new fields
            }
        });
    } catch (error) {
        console.error('Auth Route: Authentication check failed:', error);
        res.status(401).json({ error: 'Authentication check failed', message: error.message });
    }
});

// Get user profile (already includes brand_voice and target_audience from database.js update)
router.get('/profile', async (req, res) => {
    try {
        console.log('Auth Route: Accessing profile...');
        let user;
        if (req.user) { // Check if authMiddleware already set req.user
            user = req.user;
            console.log('Auth Route: Profile fetched from req.user (via authMiddleware).');
        } else if (req.session && req.session.userId) { // Fallback if middleware wasn't used or failed
            // This will now include brand_voice and target_audience due to database.js update
            user = await database.getUserById(req.session.userId);
            if (!user) {
                console.warn('Auth Route: Profile request for non-existent user via session. Clearing session.');
                authService.clearSession(req);
                return res.status(404).json({ error: 'User profile not found.' });
            }
            console.log('Auth Route: Profile fetched from DB via session.userId.');
        } else {
            console.warn('Auth Route: Profile access denied - Not authenticated (no req.user or session.userId).');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        console.log('Auth Route: Profile fetched for user:', user.id, 'Verified:', user.is_verified);
        res.json({ 
            user: { 
                id: user.id, 
                username: user.username, 
                email: user.email, 
                is_verified: user.is_verified,
                brand_voice: user.brand_voice, // Include new fields
                target_audience: user.target_audience // Include new fields
            } 
        });
    } catch (error) {
        console.error('Auth Route: Profile error for user', req.session?.userId, ':', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to get profile', message: error.message });
        }
    }
});

// NEW ROUTE: Update user profile (for brand voice and target audience)
router.put('/profile', authService.authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id; // User ID from authentication middleware
        const { brandVoice, targetAudience } = req.body;
        console.log(`Auth Route: Update profile attempt for user ${userId}. Brand Voice: ${brandVoice}, Target Audience: ${targetAudience}`);

        // Construct updates object, only including fields that are present in the request body
        const updates = {};
        if (brandVoice !== undefined) {
            updates.brandVoice = brandVoice;
        }
        if (targetAudience !== undefined) {
            updates.targetAudience = targetAudience;
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No update data provided.' });
        }

        const updatedUser = await database.updateUserProfile(userId, updates);

        if (!updatedUser) {
            console.warn(`Auth Route: Failed to update profile for user ${userId}. User not found.`);
            return res.status(404).json({ error: 'User not found.' });
        }

        console.log(`Auth Route: Profile updated successfully for user ${userId}.`);
        res.json({ 
            success: true, 
            message: 'Profile updated successfully', 
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                email: updatedUser.email,
                is_verified: updatedUser.is_verified,
                brand_voice: updatedUser.brand_voice,
                target_audience: updatedUser.target_audience
            }
        });

    } catch (error) {
        console.error('Auth Route: Error updating user profile:', error);
        res.status(500).json({ error: 'Failed to update profile', message: error.message });
    }
});


export default router;