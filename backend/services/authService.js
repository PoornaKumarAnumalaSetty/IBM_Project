import bcrypt from 'bcryptjs'; // Using bcryptjs as per your provided code
import database from '../db/database.js';

class AuthService {
    constructor() {
        this.saltRounds = 12;
    }

    // Hash password
    async hashPassword(password) {
        try {
            return await bcrypt.hash(password, this.saltRounds);
        } catch (error) {
            console.error('AuthService: Error hashing password:', error);
            throw new Error('Failed to process password');
        }
    }

    // Verify password
    async verifyPassword(plainPassword, hashedPassword) {
        try {
            return await bcrypt.compare(plainPassword, hashedPassword);
        } catch (error) {
            console.error('AuthService: Error verifying password:', error);
            throw new Error('Failed to verify password');
        }
    }

    // Register new user
    async register(userData) {
        const { username, email, password } = userData;

        // Validate input
        if (!username || !email || !password) {
            throw new Error('All fields are required');
        }

        if (username.length < 3) {
            throw new Error('Username must be at least 3 characters long');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters long');
        }

        if (!this.isValidEmail(email)) {
            throw new Error('Please provide a valid email address');
        }

        try {
            // Check if user already exists
            const existingUser = await database.getUserByEmail(email);
            if (existingUser) {
                // If user exists but is not verified, allow resending OTP
                if (!existingUser.is_verified) {
                    console.log('AuthService: User exists but unverified. Attempting to resend OTP for:', email);
                    // Generate a new OTP
                    const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
                    const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 minutes

                    await database.setOtpCode(existingUser.id, otpCode, otpExpires);
                    // Assuming emailService is available here or passed in
                    // await emailService.sendOtpEmail(existingUser.email, otpCode);

                    throw new Error('Account already exists but is unverified. A new OTP has been sent to your email for verification.');
                } else {
                    console.warn('AuthService: Registration failed - User already exists and is verified for', email);
                    throw new Error('User with that email already exists and is already verified.');
                }
            }

            // Hash password
            const passwordHash = await this.hashPassword(password);

            // Create user
            const newUser = await database.createUser(username, email, passwordHash);

            // Return user without password hash
            const { password_hash, ...userWithoutPassword } = newUser;
            console.log('AuthService: User registered successfully:', userWithoutPassword.id);
            return userWithoutPassword;

        } catch (error) {
            // Re-throw known errors, or wrap database errors
            if (error.message.includes('already exists') || error.message.includes('required') || error.message.includes('characters') || error.message.includes('valid email') || error.message.includes('unverified')) {
                throw error;
            }

            console.error('AuthService: Registration error:', error);
            throw new Error('Failed to create account. Please try again.');
        }
    }

    // Login user
    async login(email, password) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        try {
            // Get user from database
            const user = await database.getUserByEmail(email);
            if (!user) {
                console.log('AuthService: Login failed - User not found for email:', email);
                throw new Error('Invalid email or password');
            }
            console.log('AuthService: User found for email:', email);

            // Verify password
            const isPasswordValid = await this.verifyPassword(password, user.password_hash);
            if (!isPasswordValid) {
                console.log('AuthService: Login failed - Invalid password for user:', user.id);
                throw new Error('Invalid email or password');
            }
            console.log('AuthService: Password valid for user:', user.id);

            // Return user without password hash
            const { password_hash, ...userWithoutPassword } = user;
            return userWithoutPassword;

        } catch (error) {
            // Re-throw known errors
            if (error.message.includes('Invalid email') || error.message.includes('required')) {
                throw error;
            }

            console.error('AuthService: Login error:', error);
            throw new Error('Login failed. Please try again.');
        }
    }

    // Get user profile
    async getUserProfile(userId) {
        try {
            const user = await database.getUserById(userId);
            if (!user) {
                console.warn('AuthService: getUserProfile - User not found for ID:', userId);
                throw new Error('User not found');
            }
            // Ensure no password hash is returned
            const { password_hash, ...userWithoutPassword } = user;
            return userWithoutPassword;
        } catch (error) {
            console.error('AuthService: Get user profile error:', error);
            throw new Error('Failed to get user profile');
        }
    }

    // Validate email format
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Update user session data (now accepts a callback)
    updateSession(req, user, callback) { // Added callback parameter
        if (!req.session) {
            console.error('AuthService: updateSession - req.session is undefined. Session middleware likely not configured correctly or not hit before this point.');
            if (callback) callback(new Error('Session not available'));
            return;
        }
        req.session.userId = user.id;
        req.session.user = user;
        console.log('AuthService: Session updated. userId:', req.session.userId);

        // Explicitly save the session.
        req.session.save((err) => {
            if (err) {
                console.error('AuthService: Error saving session:', err);
                if (callback) callback(err); // Pass error to callback
            } else {
                console.log('AuthService: Session successfully saved to store.');
                if (callback) callback(null); // Indicate success to callback
            }
        });
    }

    // Clear user session
    clearSession(req) {
        if (!req.session) {
            console.warn('AuthService: clearSession - req.session is undefined. Cannot destroy.');
            return;
        }
        const userId = req.session.userId;
        req.session.destroy((error) => {
            if (error) {
                console.error('AuthService: Session destruction error for user', userId, ':', error);
            } else {
                console.log('AuthService: Session destroyed successfully for user', userId);
            }
        });
    }

    // Check if user is authenticated
    isAuthenticated(req) {
        console.log('AuthService: isAuthenticated check. req.session exists:', !!req.session, 'req.session.userId:', req.session?.userId);
        return req.session && req.session.userId;
    }

    // Get current user from session
    getCurrentUser(req) {
        console.log('AuthService: getCurrentUser. req.session.user:', req.session?.user);
        if (!this.isAuthenticated(req)) {
            return null;
        }
        return req.session.user;
    }

    /**
     * Middleware to authenticate requests based on session.
     * Populates `req.user` with user details if authenticated.
     * @param {object} req - Express request object.
     * @param {object} res - Express response object.
     * @param {function} next - Express next middleware function.
     */
    authenticateToken = async (req, res, next) => {
        console.log('AuthService: authenticateToken middleware called.');
        if (!this.isAuthenticated(req)) {
            console.warn('AuthService: authenticateToken - Not authenticated, denying access.');
            return res.status(401).json({ error: 'Authentication required.' });
        }

        try {
            // Fetch full user details from DB to ensure they are up-to-date
            // This also includes brand_voice and target_audience now
            const user = await database.getUserById(req.session.userId);
            if (!user) {
                console.warn('AuthService: authenticateToken - User not found in DB for session ID. Clearing session.');
                this.clearSession(req); // Clear invalid session
                return res.status(401).json({ error: 'User session invalid, please log in again.' });
            }

            // Attach user object (without password hash) to request for downstream use
            const { password_hash, ...userWithoutPassword } = user;
            req.user = userWithoutPassword;
            console.log('AuthService: authenticateToken - User authenticated and req.user set for ID:', user.id);
            next(); // Proceed to the next middleware/route handler
        } catch (error) {
            console.error('AuthService: authenticateToken - Error fetching user from DB:', error);
            res.status(500).json({ error: 'Internal server error during authentication.' });
        }
    };
}

export default new AuthService();