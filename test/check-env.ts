import dotenv from 'dotenv';
dotenv.config();

console.log('--- Checking Environment Variables ---');
console.log('GEMINI_API_KEY present:', !!process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY ? `len=${process.env.GEMINI_API_KEY.length}` : '');
console.log('REDIS_URL present:', !!process.env.REDIS_URL, process.env.REDIS_URL ? `starts_with=${process.env.REDIS_URL.substring(0, 15)}...` : '');
console.log('UPSTASH_REDIS_REST_URL present:', !!process.env.UPSTASH_REDIS_REST_URL);
console.log('UPSTASH_REDIS_REST_TOKEN present:', !!process.env.UPSTASH_REDIS_REST_TOKEN);
console.log('QDRANT_URL present:', !!process.env.QDRANT_URL, process.env.QDRANT_URL);
console.log('DATABASE_URL present:', !!process.env.DATABASE_URL, process.env.DATABASE_URL ? `starts_with=${process.env.DATABASE_URL.substring(0, 20)}...` : '');

// Look for any keys with REDIS, UPSTASH, KV in process.env
const relevantKeys = Object.keys(process.env).filter(k => 
  k.includes('REDIS') || k.includes('UPSTASH') || k.includes('KV') || k.includes('BULL') || k.includes('QUEUE')
);
console.log('All matching env keys:', relevantKeys);
relevantKeys.forEach(k => {
  console.log(`  ${k}=${process.env[k]}`);
});
