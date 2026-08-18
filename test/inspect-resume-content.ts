import fs from 'fs';
import path from 'path';

const uploadsDir = path.join(process.cwd(), 'data/uploads');
const resumeFile = 'file_1786826619995_a0ad8ab5e821.pdf';
const content = fs.readFileSync(path.join(uploadsDir, resumeFile), 'utf-8');
console.log('File length in chars:', content.length);
console.log('Full content:\n', content);

// If it is a data URL, let's decode it:
if (content.startsWith('data:')) {
  const base64Data = content.split(',')[1];
  const decodedBuf = Buffer.from(base64Data, 'base64');
  console.log('Decoded buffer length:', decodedBuf.length);
  console.log('Decoded header:', decodedBuf.slice(0, 10).toString('ascii'));
  
  // Try parsing the decoded buffer with pdf-parse
  const { PDFParser } = require('../server/parsers/pdf-parser');
  PDFParser.parse(decodedBuf).then((res: any) => {
    console.log('Decoded PDF parsed successfully!');
    console.log('Decoded text:', res.text);
    console.log('Pages:', res.pages);
  }).catch((err: any) => {
    console.error('Decoded PDF parse error:', err);
  });
}
