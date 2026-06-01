import express from 'express';
import bcrypt from 'bcrypt';
import { userDb } from '../modules/database/index.js';
import { getConnection } from '../modules/database/connection.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { isZhiguoMode, provisionUserWorkspace } from '../services/zhiguo-user-workspace.service.js';

const router = express.Router();
const db = getConnection();

const validateCredentials = (username, password) => {
  if (!username || !password) {
    return 'Username and password are required';
  }
  if (username.length < 3 || password.length < 6) {
    return 'Username must be at least 3 characters, password at least 6 characters';
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5-]+$/.test(username)) {
    return 'Username may only contain letters, numbers, underscore and Chinese characters';
  }
  return null;
};

async function finalizeUserSession(user, res) {
  if (isZhiguoMode()) {
    await provisionUserWorkspace(Number(user.id), user.username);
  }

  const token = generateToken(user);
  userDb.updateLastLogin(Number(user.id));

  res.json({
    success: true,
    user: { id: user.id, username: user.username },
    token,
  });
}

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers && !isZhiguoMode(),
      allowSignup: isZhiguoMode(),
      isAuthenticated: false
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration — single-user in OSS mode; multi-user in 智果 mode
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const validationError = validateCredentials(username, password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    db.prepare('BEGIN').run();
    try {
      if (!isZhiguoMode()) {
        const hasUsers = userDb.hasUsers();
        if (hasUsers) {
          db.prepare('ROLLBACK').run();
          return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
        }
      } else if (userDb.getUserByUsername(username)) {
        db.prepare('ROLLBACK').run();
        return res.status(409).json({ error: '用户名已被占用' });
      }

      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      const user = userDb.createUser(username, passwordHash);

      db.prepare('COMMIT').run();
      await finalizeUserSession(user, res);
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);

    if (isZhiguoMode()) {
      await provisionUserWorkspace(user.id, user.username);
    }

    // Update last login
    userDb.updateLastLogin(user.id);

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
