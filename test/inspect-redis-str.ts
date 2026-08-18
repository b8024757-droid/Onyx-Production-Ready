import dotenv from 'dotenv';
dotenv.config();

const raw = process.env.REDIS_URL || '';
console.log('Raw REDIS_URL length:', raw.length);
console.log('Raw string:', JSON.stringify(raw));
const u = new URL(raw.replace(/^["']|["']$/g, ''));
console.log('Username:', u.username);
console.log('Password:', u.password);
console.log('Password chars:', u.password.split('').map(c => c.charCodeAt(0)));
