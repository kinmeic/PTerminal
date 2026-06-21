/**
 * Shared validation utilities for frontend inputs.
 * Used before sending data to the backend to provide fast feedback.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate a terminal name (non-empty, max 100 chars). */
export function validateTerminalName(name: string): ValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: 'Name is required' };
  if (trimmed.length > 100) return { valid: false, error: 'Name must be at most 100 characters' };
  return { valid: true };
}

/** Validate a command string (non-empty when trimmed). */
export function validateCommand(command: string): ValidationResult {
  if (!command.trim()) return { valid: false, error: 'Command is required' };
  return { valid: true };
}

/** Validate a command label (optional, max 200 chars). */
export function validateCommandLabel(label: string): ValidationResult {
  if (label.length > 200) return { valid: false, error: 'Label must be at most 200 characters' };
  return { valid: true };
}

/** Validate SSH shortcut fields. */
export function validateSshShortcut(
  name: string,
  host: string,
  user: string,
  port: string | number
): ValidationResult {
  if (!name.trim()) return { valid: false, error: 'Name is required' };
  if (!host.trim()) return { valid: false, error: 'Host is required' };
  if (!user.trim()) return { valid: false, error: 'User is required' };

  const portNum = typeof port === 'string' ? Number(port) : port;
  if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }

  // Basic host validation (no spaces, not empty)
  if (/\s/.test(host.trim())) {
    return { valid: false, error: 'Host cannot contain spaces' };
  }

  return { valid: true };
}

/** Validate AI settings base URL (must be valid URL if provided). */
export function validateBaseUrl(url: string): ValidationResult {
  if (!url.trim()) return { valid: true }; // optional
  try {
    new URL(url.trim());
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/** Validate proxy URL (must be valid socks5 URL if provided). */
export function validateProxyUrl(url: string): ValidationResult {
  if (!url.trim()) return { valid: true }; // optional = direct connection
  try {
    const parsed = new URL(url.trim());
    if (!parsed.protocol.startsWith('socks5')) {
      return { valid: false, error: 'Proxy must use socks5:// or socks5h:// protocol' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid proxy URL format' };
  }
}

/** Validate font size (within reasonable bounds). */
export function validateFontSize(size: number): ValidationResult {
  if (Number.isNaN(size) || size < 8 || size > 32) {
    return { valid: false, error: 'Font size must be between 8 and 32' };
  }
  return { valid: true };
}

/** Validate context window (positive integer). */
export function validateContextWindow(value: number): ValidationResult {
  if (Number.isNaN(value) || value < 1000 || value > 1000000) {
    return { valid: false, error: 'Context window must be between 1000 and 1000000' };
  }
  return { valid: true };
}

/** Validate compression threshold (0.1 - 1.0). */
export function validateCompressionThreshold(value: number): ValidationResult {
  if (Number.isNaN(value) || value < 0.1 || value > 1.0) {
    return { valid: false, error: 'Threshold must be between 0.1 and 1.0' };
  }
  return { valid: true };
}
