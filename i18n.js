// UI strings in English and Simplified Chinese. Language = saved choice, else the phone's language.
const S = {
  en: {
    appName: 'KeeSnap', lock: 'Lock',
    setupTitle: 'Create a master password',
    setupHint: 'Everything is encrypted with this password and stays on this device. <b>If you forget it, nothing can be recovered.</b>',
    pw1: 'Master password (8+ characters)', pw2: 'Type it again', setupBtn: 'Create vault',
    tooShort: 'At least 8 characters', mismatch: "Passwords don't match",
    unlockTitle: 'Enter your master password', pw: 'Master password', unlockBtn: 'Unlock',
    unlocking: 'Unlocking…', wrongPw: 'Wrong password',
    search: 'Search: e.g. GCKey, recovery, wifi', all: 'All',
    empty: 'Nothing here yet. Tap the button below to take a photo.',
    tools: 'Backup & settings', exportBtn: 'Export encrypted backup', importBtn: 'Import encrypted backup',
    langLabel: 'Language', fab: '＋ Photo',
    title: 'Title', category: 'Category', ocrText: 'Recognized text (editable)', keepImg: 'Also save the photo (encrypted)',
    save: 'Save', cancel: 'Cancel', copy: 'Copy text', copied: 'Copied', back: 'Back', del: 'Delete',
    ocrRunning: 'Reading text (on-device, offline; first run is slower)…',
    ocrDone: 'Done in {s} s. ', ocrCheck: 'Please check it before saving.',
    ocrCheckCodes: '⚠️ Compare every character with the photo, especially look-alikes like 0/O/9, 1/l/I, 5/S, 8/B.',
    ocrFail: 'Recognition failed: {e}. You can type the text yourself.',
    confirmDel: 'Delete this item?',
    badFile: 'Not a valid backup file', notOurs: 'Not a KeeSnap backup',
    otherVault: 'This backup is from another vault. Enter its master password:',
    badBackupPw: 'Wrong backup password', imported: 'Imported {n} items',
    storage: '{mb} MB used · {p}', persisted: 'browser promised not to auto-clear',
    notPersisted: 'no persistent storage grant; export backups regularly',
    cat_recovery: 'Recovery / backup codes', cat_security: 'Security questions', cat_wifi: 'Wi-Fi',
    cat_id: 'ID numbers', cat_insurance: 'Insurance', cat_gov: 'Government accounts',
    cat_bank: 'Banking', cat_other: 'Other',
  },
  zh: {
    appName: 'KeeSnap', lock: '锁定',
    setupTitle: '设置主密码',
    setupHint: '所有内容都用这个密码加密，只存在这台设备上。<b>忘了密码就无法恢复</b>，请记牢。',
    pw1: '主密码（至少 8 位）', pw2: '再输一次', setupBtn: '创建保险箱',
    tooShort: '至少 8 位', mismatch: '两次不一致',
    unlockTitle: '输入主密码解锁', pw: '主密码', unlockBtn: '解锁',
    unlocking: '解锁中…', wrongPw: '密码不对',
    search: '搜索：如 GCKey、恢复码、wifi', all: '全部',
    empty: '还没有内容。点下面的按钮拍一张。',
    tools: '备份与设置', exportBtn: '导出加密备份', importBtn: '导入加密备份',
    langLabel: '语言', fab: '＋ 拍照',
    title: '标题', category: '分类', ocrText: '识别出的文字（可修改）', keepImg: '同时加密保存照片',
    save: '保存', cancel: '取消', copy: '复制文字', copied: '已复制', back: '返回', del: '删除',
    ocrRunning: '正在识别文字（本机离线，首次稍慢）…',
    ocrDone: '识别完成，用时 {s} 秒。', ocrCheck: '请核对后保存。',
    ocrCheckCodes: '⚠️ 请对照照片逐字核对，特别是 0/O/9、1/l/I、5/S、8/B 这类易混字符。',
    ocrFail: '识别失败：{e}。可以手动输入文字。',
    confirmDel: '确定删除这一条？',
    badFile: '不是有效的备份文件', notOurs: '不是 KeeSnap 的备份文件',
    otherVault: '这个备份来自另一个保险箱，请输入它的主密码：',
    badBackupPw: '备份密码不对', imported: '导入了 {n} 条',
    storage: '已用 {mb} MB · {p}', persisted: '浏览器已承诺不自动清理',
    notPersisted: '未获持久存储授权，建议定期导出备份',
    cat_recovery: '恢复码 / 备用码', cat_security: '密保问题', cat_wifi: 'Wi-Fi',
    cat_id: '证件号', cat_insurance: '保单', cat_gov: '政府账户',
    cat_bank: '银行 / 金融', cat_other: '其他',
  },
};

export let lang = localStorage.getItem('lang') || ((navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function t(k, vars = {}) {
  let s = (S[lang] && S[lang][k]) ?? S.en[k] ?? k;
  for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b);
  return s;
}

export function setLang(l) { lang = l; localStorage.setItem('lang', l); applyStatic(); }

// Fill every element marked data-i18n / data-i18n-ph / data-i18n-html
export function applyStatic() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('appName');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
}
