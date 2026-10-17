// Local rule-based classifier: no network, no AI. Order = priority.
import { t } from './i18n.js';
export const CATEGORIES = [
  { id: 'recovery', re: /(recovery|backup|verification)\s*code|恢复码|备用码|备份码|one[- ]time code|2fa|two[- ]factor|\b(?:[A-Z0-9]{4,5}[- ]){2,}[A-Z0-9]{4,5}\b/i },
  { id: 'security', re: /security question|secret question|challenge question|密保|安全问题|问题\s*\d|question\s*\d|answer\s*[:：]|答案\s*[:：]/i },
  { id: 'wifi', re: /wi-?fi|wlan|ssid|无线网|密码\s*[:：].*\n?.*ssid/i },
  { id: 'id', re: /passport|护照|driver'?s? licen[cs]e|驾照|health card|\bSIN\b|social insurance|PR card|枫叶卡|UCI|client id/i },
  { id: 'insurance', re: /policy\s*(no|number|#)|保单|insurance|保险/i },
  { id: 'gov', re: /IRCC|GCKey|CRA|My Account|Service Canada|ServiceOntario|移民局|税局/i },
  { id: 'bank', re: /bank|banking|RBC|TD\b|CIBC|BMO|Scotiabank|Tangerine|Wealthsimple|account\s*(no|number)|银行|账号/i },
  { id: 'other', re: /.^/ },
];

export function classify(text) {
  for (const c of CATEGORIES) if (c.re.test(text)) return c.id;
  return 'other';
}

export function labelOf(id) {
  return t('cat_' + (CATEGORIES.some((c) => c.id === id) ? id : 'other'));
}

// Title: first meaningful line
export function suggestTitle(text, cat) {
  const line = (text || '').split('\n').map((s) => s.trim()).find((s) => s.length >= 3) || '';
  return line ? line.slice(0, 40) : labelOf(cat);
}
