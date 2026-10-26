const CODE_LINE = /^\s*[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\s*$/;
const TITLE_CODE_PATTERN = /\b[A-Za-z0-9]{2,6}(?:-[A-Za-z0-9]{2,6})+\b/;
const SECRET_LABEL = /\b(?:password|passphrase|passcode|pin|answer|secret)\b/i;
const CODE_LIKE_LINE = CODE_LINE;

export function filterNonCodeLines(text) {
  const lines = (text || '').split(/\r?\n/);
  const codeLineCount = lines.filter((line) => CODE_LIKE_LINE.test(line)).length;
  if (codeLineCount === 0) return { text: lines.join('\n'), removedLines: [], foundCodes: false };
  const kept = [];
  const removedLines = [];
  for (const line of lines) {
    if (CODE_LIKE_LINE.test(line) || !line.trim()) kept.push(line);
    else removedLines.push(line);
  }
  return { text: kept.join('\n'), removedLines, foundCodes: true };
}

function mostlyChinese(line) {
  const chars = Array.from(line).filter((char) => !/\s/u.test(char));
  if (!chars.length) return false;
  const chinese = chars.filter((char) => /[\u3400-\u9fff]/u.test(char)).length;
  return chinese / chars.length >= 0.5;
}

export function countCodeLikeLines(text) {
  return (text || '').split(/\r?\n/).filter((line) => CODE_LINE.test(line)).length;
}

export function keepAutoOcrLines(text) {
  const filtered = filterNonCodeLines(text);
  return filtered.foundCodes && countCodeLikeLines(text) >= 2
    ? { ...filtered, usedCode: true }
    : { text: text || '', removedLines: [], usedCode: false };
}

export function looksLikeNormalText(text, confidence) {
  if (Number.isFinite(confidence) && confidence < 45) return false;
  const words = (text || '').match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length === 0) return false;
  const realWords = words.filter((word) => word.length >= 3).length;
  const shortFragments = words.filter((word) => word.length <= 2).length;
  const fragmentRatio = shortFragments / words.length;
  return realWords >= 3 && !(words.length >= 5 && fragmentRatio >= 0.55);
}

export async function selectAutoOcr(firstPass, category, runCode) {
  const firstText = firstPass.text || '';
  const codeCategory = ['recovery', 'wifi', 'security'].includes(category);
  const needsFallback = codeCategory || countCodeLikeLines(firstText) > 0 || !looksLikeNormalText(firstText, firstPass.confidence);
  if (!needsFallback) return { text: firstText, usedCode: false };

  const codePass = await runCode();
  const firstCount = countCodeLikeLines(firstText);
  const codeCount = countCodeLikeLines(codePass.text);
  if (codeCount <= firstCount) return { text: firstText, usedCode: true };

  const chineseLines = firstText.split(/\r?\n/).filter(mostlyChinese);
  const combined = [codePass.text, ...chineseLines].filter(Boolean).join('\n');
  const filtered = filterNonCodeLines(combined);
  return { ...filtered, usedCode: true };
}

export function safeTitle(text, category, categoryLabel, dateLabel) {
  if (!['recovery', 'wifi', 'security'].includes(category)) {
    return (text || '').split('\n').map((line) => line.trim()).find((line) => line.length >= 3)?.slice(0, 40) || categoryLabel;
  }
  const heading = (text || '').split(/\r?\n/).map((line) => line.trim())
    .find((line) => {
      const words = line.match(/[\p{L}\p{N}]+/gu) || [];
      return words.length >= 2 && !TITLE_CODE_PATTERN.test(line) && !SECRET_LABEL.test(line) && !/[?？!@#$%^&*+=]/.test(line);
    });
  return heading?.slice(0, 40) || `${categoryLabel} - ${dateLabel}`;
}
