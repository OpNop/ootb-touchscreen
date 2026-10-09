// Usage: npm run create-admin -- "Name" email@example.com password
import './env.js';
import { db } from './db.js';
import { hashPassword, newTopic } from './auth.js';

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 8) {
  console.error('Usage: npm run create-admin -- "Name" email@example.com password(8+ chars)');
  process.exit(1);
}
db.prepare(
  `INSERT INTO staff (name, email, password_hash, role, ntfy_topic) VALUES (?,?,?,'admin',?)
   ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin', active = 1`,
).run(name, email.toLowerCase(), hashPassword(password), newTopic());
console.log(`Admin ready: ${email}`);
