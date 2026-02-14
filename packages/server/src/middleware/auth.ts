import type { MiddlewareHandler } from 'hono';
import { verifyToken, isAuthEnabled } from '../services/auth';

/**
 * Auth middleware — checks JWT token from Authorization header.
 * When auth is not enabled (no users exist), passes through.
 * Skips auth for /auth/* routes and /health.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  // Always skip auth for these paths
  if (path === '/health' || path.startsWith('/api/auth/') || path === '/api/auth') {
    return next();
  }

  // If auth is not enabled, pass through (single-user mode)
  if (!isAuthEnabled()) {
    return next();
  }

  // Extract token from Authorization header
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return c.json({ ok: false, error: 'Authentication required' }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return c.json({ ok: false, error: 'Invalid or expired token' }, 401);
  }

  // Attach user info to context
  c.set('user' as any, payload);
  return next();
};
