import authService from '../services/authService.js';

export function authMiddleware(req, res, next) {
    // Check if user is authenticated
    if (!authService.isAuthenticated(req)) {
        return res.status(401).json({ 
            error: 'Authentication required',
            message: 'Please log in to access this resource'
        });
    }

    // Add user to request object for easy access
    req.user = authService.getCurrentUser(req);
    
    // Proceed to next middleware/route handler
    next();
}

export function optionalAuthMiddleware(req, res, next) {
    // Add user to request object if authenticated, but don't require it
    if (authService.isAuthenticated(req)) {
        req.user = authService.getCurrentUser(req);
    }
    
    next();
}

export default authMiddleware;