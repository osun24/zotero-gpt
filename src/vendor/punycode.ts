function normalizeHostname(input: string) {
  try {
    return new URL(`http://${input}`).hostname;
  } catch {
    return input;
  }
}

export function toASCII(input: string) {
  return normalizeHostname(input);
}

// markdown-it only uses this to prettify displayed links. Falling back to the
// original hostname is acceptable when a full punycode decoder is unavailable.
export function toUnicode(input: string) {
  return input;
}

export default {
  toASCII,
  toUnicode,
};
