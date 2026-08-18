import { HTMLParser, ParsedHTMLResult } from './html-parser';
import { URL } from 'url';

export interface URLFetchResult {
  url: string;
  title: string;
  content: string;
  statusCode: number;
  contentType: string;
  parsed: ParsedHTMLResult;
}

export class URLFetcher {
  private static isPrivateIP(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      lower === '127.0.0.1' ||
      lower === '0.0.0.0' ||
      lower === '::1' ||
      lower === 'metadata.google.internal' ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal')
    ) {
      return true;
    }

    // IP regex checks
    const ipv4Match = lower.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const a = parseInt(ipv4Match[1], 10);
      const b = parseInt(ipv4Match[2], 10);
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 127) return true; // 127.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 169 && b === 254) return true; // 169.254.0.0/16
    }

    return false;
  }

  public static async fetch(urlString: string): Promise<URLFetchResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      throw new Error(`Invalid URL format: "${urlString}"`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported protocol "${parsedUrl.protocol}". Only HTTP and HTTPS are permitted.`);
    }

    if (this.isPrivateIP(parsedUrl.hostname)) {
      throw new Error(`Access to private, loopback, or metadata addresses is blocked for security (SSRF Protection).`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(urlString, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SecondBrainBot/1.0 (+https://ai.studio/build)',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP fetch failed with status ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
        throw new Error(`Non-HTML content type received: ${contentType}`);
      }

      const body = await response.text();
      if (body.length > 5 * 1024 * 1024) {
        throw new Error(`Response body exceeds maximum allowed page size (5MB).`);
      }

      const parsed = HTMLParser.parse(body, urlString);

      return {
        url: urlString,
        title: parsed.title,
        content: parsed.text,
        statusCode: response.status,
        contentType,
        parsed,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`HTTP request timed out after 10000ms while fetching ${urlString}`);
      }
      throw new Error(`URL ingestion failed for ${urlString}: ${err.message || err}`);
    }
  }
}
