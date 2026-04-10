/**
 * Extracts the Google Drive File ID from a URL or returns the ID if already provided.
 */
export const extractFileId = (input: string): string => {
  if (!input) return '';
  
  // Handle full URL or just ID
  // Look for the pattern between /d/ and /
  const urlMatch = input.match(/\/d\/([-\w]{25,})/);
  if (urlMatch) return urlMatch[1];
  
  // Fallback to general ID pattern
  const idMatch = input.match(/([-\w]{25,})/);
  return idMatch ? idMatch[1] : input.trim();
};
