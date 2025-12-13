/**
 * Input Sanitization Utilities
 * Prevents XSS and injection attacks
 */

/**
 * Sanitize user input by removing potentially dangerous characters
 * @param input - Raw user input string
 * @returns Sanitized string safe for display and storage
 */
export function sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') return '';

    return input
        // Remove script tags
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove on* event handlers
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
        // Escape HTML entities
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        // Remove javascript: and data: URLs
        .replace(/javascript:/gi, '')
        .replace(/data:/gi, '')
        .trim();
}

/**
 * Sanitize input for search queries (less strict, allows special chars)
 * @param input - Raw search input
 * @returns Cleaned search string
 */
export function sanitizeSearchInput(input: string): string {
    if (!input || typeof input !== 'string') return '';

    return input
        // Remove script tags
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove HTML tags but keep content
        .replace(/<[^>]*>/g, '')
        // Remove null bytes
        .replace(/\0/g, '')
        .trim()
        // Limit length to prevent DoS
        .slice(0, 500);
}

/**
 * Validate and sanitize URL
 * @param url - Raw URL string
 * @returns Valid URL or null if invalid
 */
export function sanitizeUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();

    // Block dangerous protocols
    if (/^(javascript|data|vbscript):/i.test(trimmed)) {
        return null;
    }

    // Ensure it starts with http(s) or is relative
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/')) {
        return `https://${trimmed}`;
    }

    return trimmed;
}

/**
 * Sanitize phone number (keep only digits and common separators)
 * @param phone - Raw phone input
 * @returns Cleaned phone string
 */
export function sanitizePhone(phone: string): string {
    if (!phone || typeof phone !== 'string') return '';

    return phone
        // Keep digits, spaces, parentheses, dashes, and plus
        .replace(/[^\d\s()\-+]/g, '')
        .trim()
        .slice(0, 20);
}

/**
 * Validate email format
 * @param email - Email to validate
 * @returns true if valid email format
 */
export function isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}
