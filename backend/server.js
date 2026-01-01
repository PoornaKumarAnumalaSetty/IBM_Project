import express from 'express';
import session from 'express-session';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import database from './db/database.js'; // Needed for the public share view route
import http from 'http'; // NEW: For making HTTP requests to Ngrok API

// Import routes
import authRoutes from './routes/auth.js';
import generateRoutes from './routes/generate.js';
import calendarRoutes from './routes/calendar.js';
import shareRoutes from './routes/share.js';

// Import middleware
import { authMiddleware } from './middleware/authMiddleware.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// NEW GLOBAL VARIABLE: To store the dynamically fetched Ngrok URL
let NGROK_PUBLIC_URL = null;

// NEW FUNCTION: Fetches the Ngrok public URL from its local API
async function fetchNgrokPublicUrl() {
    return new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const tunnels = JSON.parse(data).tunnels;
                    const publicUrl = tunnels.find(t => t.proto === 'https')?.public_url;
                    if (publicUrl) {
                        console.log(`✅ Ngrok public URL detected: ${publicUrl}`);
                        resolve(publicUrl);
                    } else {
                        reject(new Error('No HTTPS tunnel found from Ngrok. Is Ngrok running and forwarding port 3000?'));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse Ngrok API response: ${e.message}`));
                }
            });
        });
        req.on('error', (e) => {
            reject(new Error(`Failed to connect to Ngrok API (http://127.0.0.1:4040): ${e.message}. Is Ngrok running?`));
        });
    });
}

// NEW FUNCTION: Retries fetching Ngrok URL
async function initializeNgrokUrl(retries = 5, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            NGROK_PUBLIC_URL = await fetchNgrokPublicUrl();
            return; // Success
        } catch (error) {
            console.warn(`⚠️ Attempt ${i + 1}/${retries}: ${error.message}. Retrying in ${delay / 1000} seconds...`);
            if (i < retries - 1) {
                await new Promise(res => setTimeout(res, delay));
            } else {
                console.error('❌ Failed to get Ngrok public URL after multiple retries. Share links may not work externally.');
            }
        }
    }
}


// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1); // Required when behind ngrok or any proxy

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true when served over https (e.g., ngrok)
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve trending topics data
app.use('/data', express.static(path.join(__dirname, '../data')));

// API Routes (authenticated)
app.use('/api/auth', authRoutes);
app.use('/api/generate', authMiddleware, generateRoutes);
app.use('/api/calendar', authMiddleware, calendarRoutes);
// Pass the NGROK_PUBLIC_URL to shareRoutes
app.use('/api/share', authMiddleware, (req, res, next) => {
    req.ngrokPublicUrl = NGROK_PUBLIC_URL; // Attach to request object
    next();
}, shareRoutes);


// Public API route for shared calendar data (DOES NOT require authMiddleware)
app.get('/api/share/view/:token', async (req, res) => {
    const { token } = req.params;
    console.log('Server: GET /api/share/view/:token called for token (partial):', token.substring(0, 10) + '...');
    try {
        const shareLink = await database.getShareLinkByToken(token);

        if (!shareLink) {
            console.warn('Server: Invalid or expired share token:', token);
            return res.status(404).json({ error: 'Invalid or expired share link.' });
        }

        // Fetch scheduled posts for the owner of the share link
        const scheduledPosts = await database.getScheduledPosts(shareLink.user_id);
        console.log('Server: Fetched', scheduledPosts.length, 'scheduled posts for shared link owner:', shareLink.owner_username);

        // Filter out sensitive user data from the shareLink object before sending
        const { owner_email, ...safeShareLink } = shareLink;

        res.json({
            success: true,
            owner: {
                username: shareLink.owner_username,
            },
            scheduledPosts: scheduledPosts,
            linkDetails: safeShareLink
        });

    } catch (error) {
        console.error('Server: Error viewing shared link:', error);
        res.status(500).json({
            error: 'Failed to retrieve shared content',
            message: error.message
        });
    }
});


// Public share view frontend route (serves the HTML page)
app.get('/share/:token', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/share-view.html'));
});


// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Serve frontend pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/register.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
});

app.get('/calendar', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/calendar.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Error:`, {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        path: req.path,
        method: req.method
    });
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, async () => { // Made listen callback async
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Frontend: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);

    // NEW: Initialize Ngrok URL on server startup
    await initializeNgrokUrl();
});

export default app;