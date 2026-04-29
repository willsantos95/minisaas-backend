import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export function signJwt(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function generateApiKey() {
  return `rn8n_${crypto.randomBytes(32).toString('hex')}`;
}
