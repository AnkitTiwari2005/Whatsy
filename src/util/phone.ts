import { config } from '../config';

export type PhoneResult =
  | { ok: true; digits: string; e164: string; clean: string; formatted: string; jid: string }
  | { ok: false; error: string; clean?: never; formatted?: never; jid?: never };

/**
 * Normalise user-supplied phone input to E.164 digits.
 * Accepts strings or integers; allows only digits and common separators ("+91 98765-43210", "(0) 98765 43210").
 * Rejects free text, so "call me on 9876543210" is an error instead of silently becoming a recipient.
 */
export function normalizePhone(input: unknown): PhoneResult {
  let s: string;
  if (typeof input === 'number' && Number.isSafeInteger(input) && input > 0) s = String(input);
  else if (typeof input === 'string') s = input.trim();
  else return { ok: false, error: 'must be a phone number string such as "+919876543210"' };

  if (s.length === 0 || s.length > 32) return { ok: false, error: 'must be a phone number string such as "+919876543210"' };
  if (!/^\+?[\d\s\-().]+$/.test(s)) return { ok: false, error: 'may only contain digits, spaces and + - ( ) .' };

  const hasPlus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  const cc = config.defaultCountryCode || '91';
  if (!hasPlus) {
    if (d.startsWith('00')) d = d.slice(2);
    else if (cc) {
      if (d.startsWith('0')) d = cc + d.replace(/^0+/, '');
      else if (d.length <= 10) d = cc + d;
    }
  }
  if (d.length < 7 || d.length > 15) return { ok: false, error: 'must contain 7 to 15 digits including the country code' };
  if (d.startsWith('0')) return { ok: false, error: 'must start with the country code (not 0). Set DEFAULT_COUNTRY_CODE to accept local numbers' };
  return { ok: true, digits: d, e164: '+' + d, clean: d, formatted: '+' + d, jid: `${d}@s.whatsapp.net` };
}
