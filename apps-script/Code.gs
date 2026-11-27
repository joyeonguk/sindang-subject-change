/**
 * 선택과목 변경 관리 — 연결 통로 (천안신당고등학교 교육과정부)
 *
 * GitHub 페이지(index.html)가 이 웹 앱 주소로 요청을 보내면,
 * 교사 비밀번호를 확인한 뒤 학년별 과목선택 시트를 읽고 씁니다.
 *
 * 설치 (처음 한 번)
 *  1) 아래 「설정」에 학년별 비밀번호와 시트 ID를 채웁니다. (시트 주소의 /d/ 와 /edit 사이 값이 시트 ID)
 *  2) 저장 → 배포 → 새 배포 → 유형: 웹 앱
 *     · 다음 사용자 인증 정보로 실행: 나
 *     · 액세스 권한이 있는 사용자: 모든 사용자
 *  3) 권한 승인 → 나온 웹 앱 URL(…/exec)을 GitHub 저장소의 config.js 에 넣습니다.
 *  코드를 고친 뒤에는 배포 관리 → 연필 → 버전: 새 버전 → 배포 (주소는 그대로)
 */

// ───────── 설정 ─────────
// 학년마다 담임선생님 비밀번호가 따로 있습니다. 1학년 비밀번호로는 1학년 시트만 열립니다.
const SHEETS = {
  '1': { pw: '여기에-1학년-비밀번호', id: '여기에-1학년-시트-ID', tab: '천안신당고등학교 과목선택 DB', n1: 6, n2: 6, sciCol: 16 }, // B~G, H~M, P열 과학중점
  '2': { pw: '여기에-2학년-비밀번호', id: '여기에-2학년-시트-ID', tab: '2학년 과목선택', n1: 7, n2: 7, sciCol: 0 }            // B~H, I~O
};

// ───────── 기록 탭 ─────────
const LOG_SHEET = '변경신청';
const LOG_HEAD = ['신청번호', '학번', '이름', '상태', '변경내역', '변경사유', '과학중점 희망', '체육특성화 희망', '신청일',
  '작성일시', '출력일시', '접수완료일시', '기존 과목(JSON)', '변경 후 과목(JSON)', '변경(JSON)',
  '작성 선생님', '출력 선생님', '접수 선생님'];
const L = {}; LOG_HEAD.forEach(function (h, i) { L[h] = i; });

function doGet() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">선택과목 변경 관리 연결 주소입니다. 이 주소를 GitHub 저장소의 config.js 에 넣어 사용하세요.</p>');
}

function doPost(e) {
  let out;
  try {
    const q = JSON.parse(e.postData.contents);
    const g = SHEETS[String(q.grade)];
    if (!g) throw new Error('학년을 골라 주세요.');
    if (String(q.pw || '') !== String(g.pw)) throw new Error(q.grade + '학년 담임교사 비밀번호가 맞지 않습니다.');
    const fn = { ping: ping, load: load, save: save, apply: apply, remove: remove, revert: revert }[q.fn];
    if (!fn) throw new Error('알 수 없는 요청입니다.');
    ensureTriggers_();
    out = { ok: true, data: fn(q) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ───────── 도우미 ─────────
function cfg_(grade) {
  const c = SHEETS[String(grade)];
  if (!c) throw new Error('학년 정보가 올바르지 않습니다.');
  return c;
}
function book_(grade) { return SpreadsheetApp.openById(cfg_(grade).id); }
function db_(grade) {
  const sh = book_(grade).getSheetByName(cfg_(grade).tab);
  if (!sh) throw new Error('「' + cfg_(grade).tab + '」 탭을 찾지 못했습니다.');
  return sh;
}
function log_(grade) {
  const ss = book_(grade);
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) { sh = ss.insertSheet(LOG_SHEET); sh.setFrozenRows(1); }
  const head = sh.getRange(1, 1, 1, LOG_HEAD.length).getValues()[0];
  if (head.join('|') !== LOG_HEAD.join('|')) sh.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold');
  return sh;
}
function now_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
function norm_(s) {
  return String(s || '').replace(/\*/g, '').replace(/\s+/g, '').replace(/III$/, 'Ⅲ').replace(/II$/, 'Ⅱ').replace(/I$/, 'Ⅰ');
}
function same_(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (norm_(a[i]) !== norm_(b[i])) return false;
  return true;
}
function teacher_(q) {
  const t = String(q.teacher || '').trim();
  if (!t) throw new Error('선생님 성함을 입력해 주세요.');
  return t.slice(0, 30);
}
function pad_(arr, n) { arr = arr.map(function (x) { return String(x || '').trim(); }); while (arr.length < n) arr.push(''); return arr.slice(0, n); }

function readRow_(sh, row, width) { return sh.getRange(row, 1, 1, width).getDisplayValues()[0]; }

function toRow_(r) {
  return [r.no, r.id, r.name, r.status, (r.changes || []).map(function (c) { return c.sem + '학기 ' + c.from + ' → ' + c.to; }).join('\n'),
    r.reason || '', r.science || '', r.pe || '', r.date || '', r.createdAt || '', r.printedAt || '', r.doneAt || '',
    JSON.stringify(r.before || {}), r.after ? JSON.stringify(r.after) : '', JSON.stringify(r.changes || []),
    r.createdBy || '', r.printedBy || '', r.doneBy || ''];
}
function fromRow_(v, i) {
  const j = function (x, d) { try { return JSON.parse(x); } catch (e) { return d; } };
  return {
    no: v[L['신청번호']], id: String(v[L['학번']]), name: v[L['이름']], status: v[L['상태']] || '작성',
    reason: v[L['변경사유']], science: v[L['과학중점 희망']], pe: v[L['체육특성화 희망']], date: v[L['신청일']],
    createdAt: v[L['작성일시']], printedAt: v[L['출력일시']], doneAt: v[L['접수완료일시']],
    before: j(v[L['기존 과목(JSON)']], { sem1: [], sem2: [] }), after: j(v[L['변경 후 과목(JSON)']], null), changes: j(v[L['변경(JSON)']], []),
    createdBy: v[L['작성 선생님']] || '', printedBy: v[L['출력 선생님']] || '', doneBy: v[L['접수 선생님']] || '', logRow: i
  };
}

// ───────── 요청 ─────────
const VERSION = 7; // 웹 페이지가 이 번호로 최신 코드가 배포됐는지 확인합니다.
function ping(q) { db_(q.grade); return { grade: q.grade, tab: cfg_(q.grade).tab, version: VERSION }; }

/** 학생 전체(학번순)와 변경 기록 */
function load(q) {
  const lock0 = LockService.getScriptLock();
  let restored = [];
  if (lock0.tryLock(20000)) { try { restored = reconcile_(q.grade); } finally { lock0.releaseLock(); } }
  const c = cfg_(q.grade), sh = db_(q.grade), width = 1 + c.n1 + c.n2;
  // 마지막 학생 행은 A열 기준. 서명(이미지)·비밀번호 칸은 무거우므로 읽지 않습니다.
  const colA = sh.getRange(1, 1, sh.getMaxRows(), 1).getDisplayValues();
  let last = colA.length;
  while (last > 1 && !String(colA[last - 1][0]).trim()) last--;
  const v = last > 1 ? sh.getRange(2, 1, last - 1, width).getDisplayValues() : [];
  const sci = (c.sciCol && last > 1) ? sh.getRange(2, c.sciCol, last - 1, 1).getDisplayValues() : [];
  const byId = {};
  v.forEach(function (r, i) {
    const m = String(r[0] || '').trim().match(/^(\d{5})\s*(.+)$/);
    if (!m) return;
    byId[m[1]] = { id: m[1], name: m[2].trim(), row: i + 2,
      raw1: pad_(r.slice(1, 1 + c.n1), c.n1), raw2: pad_(r.slice(1 + c.n1, width), c.n2),
      science: sci[i] ? String(sci[i][0] || '').trim() : '' };
  });
  const lg = log_(q.grade), ln = lg.getLastRow();
  const lv = ln > 1 ? lg.getRange(2, 1, ln - 1, LOG_HEAD.length).getDisplayValues() : [];
  return {
    restored: restored,
    sheet: { url: book_(q.grade).getUrl(), dbGid: sh.getSheetId(), logGid: lg.getSheetId() },
    students: Object.keys(byId).sort().map(function (k) { return byId[k]; }),
    requests: lv.map(function (r, i) { return r[0] ? fromRow_(r, i + 2) : null; }).filter(Boolean)
  };
}

/** 신청번호로 기록 줄을 찾습니다. (다른 선생님이 줄을 지워도 엉뚱한 줄을 고치지 않도록) */
function findRow_(lg, no) {
  const ln = lg.getLastRow();
  if (!no || ln < 2) return 0;
  const ids = lg.getRange(2, 1, ln - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(no)) return i + 2;
  return 0;
}

/** 작성 저장 / 출력(처리중) / 처리중 → 작성 되돌리기 */
function save(q) {
  const t = teacher_(q), r = q.req, lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const lg = log_(q.grade);
    let row = findRow_(lg, r.no);
    if (!row) {
      const ln = lg.getLastRow();
      if (ln > 1) {
        const open = lg.getRange(2, 1, ln - 1, LOG_HEAD.length).getDisplayValues().filter(function (v) {
          return String(v[L['학번']]) === String(r.id) && (v[L['상태']] === '작성' || v[L['상태']] === '처리중');
        })[0];
        if (open) throw new Error('이 학생은 ' + (open[L['작성 선생님']] || '다른') + ' 선생님이 이미 작성 중입니다. 새로고침해 주세요.');
      }
    } else {
      const st = lg.getRange(row, L['상태'] + 1).getDisplayValue();
      if (st === '접수완료') throw new Error('이미 접수 완료된 신청입니다. 새로고침해 주세요.');
    }
    if (!r.createdBy) r.createdBy = t;
    if (!r.createdAt) r.createdAt = now_();
    if (q.printing) { r.printedBy = t; r.printedAt = now_(); }
    if (r.status === '작성') { r.printedBy = ''; r.printedAt = ''; }
    if (row) lg.getRange(row, 1, 1, LOG_HEAD.length).setValues([toRow_(r)]);
    else { lg.appendRow(toRow_(r)); row = lg.getLastRow(); }
    r.logRow = row;
    return r;
  } finally { lock.releaseLock(); }
}

/** 학번으로 DB 탭의 학생 행을 찾습니다. */
function studentRow_(sh, id) {
  const a = sh.getRange(1, 1, sh.getMaxRows(), 1).getDisplayValues();
  for (let i = 1; i < a.length; i++) if (String(a[i][0]).trim().slice(0, 5) === String(id)) return i + 1;
  return 0;
}

/** 신청 완전 삭제: 「변경신청」 탭에서 줄을 지웁니다.
 *  접수완료 신청은 DB 탭의 그 학생 과목을 바뀌기 전으로 되돌린 뒤 지웁니다. */
function remove(q) {
  teacher_(q);
  const c = cfg_(q.grade), nos = [].concat(q.nos || []).map(String), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const lg = log_(q.grade), sh = db_(q.grade), width = 1 + c.n1 + c.n2;
    const items = [];
    nos.forEach(function (no) {
      const row = findRow_(lg, no);
      if (row) items.push(fromRow_(lg.getRange(row, 1, 1, LOG_HEAD.length).getDisplayValues()[0], row));
    });
    // 1) 확인: 접수완료는 지금 시트 과목이 '변경 후'와 같아야 되돌릴 수 있습니다. (같은 학생은 최근 것부터)
    const restores = [], cur = {};
    items.filter(function (r) { return r.status === '접수완료' && r.after; })
      .sort(function (a, b) { return b.logRow - a.logRow; })
      .forEach(function (r) {
        if (!cur[r.id]) {
          const row = studentRow_(sh, r.id);
          if (!row) throw new Error(r.id + ' ' + r.name + ' 학생을 시트에서 찾지 못해 되돌릴 수 없습니다.');
          const v = readRow_(sh, row, width);
          cur[r.id] = { row: row, s1: pad_(v.slice(1, 1 + c.n1), c.n1), s2: pad_(v.slice(1 + c.n1, width), c.n2) };
        }
        const k = cur[r.id];
        if (!same_(k.s1, r.after.sem1) || !same_(k.s2, r.after.sem2)) {
          throw new Error(r.id + ' ' + r.name + ' 학생은 접수 뒤에 시트 과목이 또 바뀌어서 자동으로 되돌릴 수 없습니다. 시트에서 직접 확인해 주세요. (아무것도 지우지 않았습니다)');
        }
        k.s1 = pad_(r.before.sem1, c.n1); k.s2 = pad_(r.before.sem2, c.n2); k.dirty = true;
      });
    // 2) 시트 과목 되돌리기
    Object.keys(cur).forEach(function (id) {
      const k = cur[id];
      if (k.dirty) { sh.getRange(k.row, 2, 1, c.n1 + c.n2).setValues([k.s1.concat(k.s2)]); restores.push(id); }
    });
    // 3) 기록 줄 지우기 (아래쪽부터)
    items.map(function (r) { return r.logRow; }).sort(function (a, b) { return b - a; }).forEach(function (row) { lg.deleteRow(row); });
    items.forEach(function (r) { dropSnap_(q.grade, r.no); });
    return { removed: items.length, restored: restores.length };
  } finally { lock.releaseLock(); }
}

/** 서명본 접수 완료: DB 행의 과목 칸을 바꾸고 기록을 접수완료로 */
function apply(q) {
  const t = teacher_(q), r = q.req, c = cfg_(q.grade), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = db_(q.grade), width = 1 + c.n1 + c.n2, lg = log_(q.grade);
    const logRow = findRow_(lg, r.no);
    if (!logRow) throw new Error('이 신청 기록을 찾지 못했습니다. 다른 선생님이 지웠을 수 있어요. 새로고침해 주세요.');
    const row = Number(q.row);
    if (!(row > 1)) throw new Error('학생 행 정보가 없습니다. 새로고침해 주세요.');
    const cur = readRow_(sh, row, width);
    if (String(cur[0] || '').trim().slice(0, 5) !== String(r.id)) throw new Error('시트의 학생 행이 바뀌었습니다. 새로고침 후 다시 해 주세요.');
    const s1 = pad_(cur.slice(1, 1 + c.n1), c.n1), s2 = pad_(cur.slice(1 + c.n1, width), c.n2);
    if (!same_(s1, r.before.sem1) || !same_(s2, r.before.sem2)) throw new Error('그 사이 시트의 이 학생 과목이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.');
    const a1 = s1.slice(), a2 = s2.slice();
    (r.changes || []).forEach(function (ch) {
      const l = String(ch.sem) === '1' ? a1 : a2;
      const i = l.map(norm_).indexOf(norm_(ch.from));
      if (i < 0) throw new Error(ch.sem + '학기 「' + ch.from + '」 과목을 시트에서 찾지 못했습니다.');
      l[i] = ch.to;
    });
    sh.getRange(row, 2, 1, c.n1 + c.n2).setValues([a1.concat(a2)]);
    r.after = { sem1: a1, sem2: a2 }; r.status = '접수완료'; r.doneAt = now_(); r.doneBy = t;
    saveSnap_(q.grade, r);
    if (!r.createdBy) r.createdBy = t;
    lg.getRange(logRow, 1, 1, LOG_HEAD.length).setValues([toRow_(r)]);
    r.logRow = logRow;
    return r;
  } finally { lock.releaseLock(); }
}

/** 접수 되돌리기: 시트 과목을 바뀌기 전으로 복구하고 기록을 「처리중」으로 */
function revert(q) {
  teacher_(q);
  const r = q.req, c = cfg_(q.grade), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = db_(q.grade), width = 1 + c.n1 + c.n2, lg = log_(q.grade);
    const logRow = findRow_(lg, r.no);
    if (!logRow) throw new Error('이 신청 기록을 찾지 못했습니다. 새로고침해 주세요.');
    const saved = fromRow_(lg.getRange(logRow, 1, 1, LOG_HEAD.length).getDisplayValues()[0], logRow);
    if (saved.status !== '접수완료' || !saved.after) throw new Error('접수 완료된 신청만 되돌릴 수 있습니다.');
    const row = Number(q.row);
    const cur = readRow_(sh, row, width);
    if (String(cur[0] || '').trim().slice(0, 5) !== String(saved.id)) throw new Error('시트의 학생 행이 바뀌었습니다. 새로고침 후 다시 해 주세요.');
    const s1 = pad_(cur.slice(1, 1 + c.n1), c.n1), s2 = pad_(cur.slice(1 + c.n1, width), c.n2);
    if (!same_(s1, saved.after.sem1) || !same_(s2, saved.after.sem2)) throw new Error('접수 뒤에 시트의 이 학생 과목이 또 바뀌어서 자동으로 되돌릴 수 없습니다. 시트에서 직접 확인해 주세요.');
    sh.getRange(row, 2, 1, c.n1 + c.n2).setValues([pad_(saved.before.sem1, c.n1).concat(pad_(saved.before.sem2, c.n2))]);
    saved.status = '처리중'; saved.after = null; saved.doneAt = ''; saved.doneBy = '';
    dropSnap_(q.grade, saved.no);
    lg.getRange(logRow, 1, 1, LOG_HEAD.length).setValues([toRow_(saved)]);
    return saved;
  } finally { lock.releaseLock(); }
}

// ───────── 시트에서 직접 지웠을 때 원래 과목으로 되돌리기 ─────────
// 접수 완료 때 「바뀌기 전 → 바뀐 뒤」 과목을 따로 보관합니다(스크립트 속성).
// 「변경신청」 탭에서 그 줄이 사라지면, DB 탭 과목이 아직 '바뀐 뒤' 그대로일 때만 '바뀌기 전'으로 되돌립니다.
const props = PropertiesService.getScriptProperties();
function snapKey_(grade, no) { return 'D' + grade + '_' + no; }
function saveSnap_(grade, r) { props.setProperty(snapKey_(grade, r.no), JSON.stringify({ id: r.id, name: r.name, before: r.before, after: r.after })); }
function dropSnap_(grade, no) { props.deleteProperty(snapKey_(grade, no)); }

/** 보관본과 「변경신청」 탭을 맞춰 봅니다. 되돌린 학생 목록을 돌려줍니다. */
function reconcile_(grade) {
  const c = cfg_(grade), lg = log_(grade), sh = db_(grade), width = 1 + c.n1 + c.n2, pre = 'D' + grade + '_';
  const all = props.getProperties(), ln = lg.getLastRow();
  const rows = ln > 1 ? lg.getRange(2, 1, ln - 1, LOG_HEAD.length).getDisplayValues() : [];
  const present = {};
  rows.forEach(function (v, i) { if (v[0]) present[String(v[0])] = fromRow_(v, i + 2); });
  const restored = [];
  Object.keys(all).filter(function (k) { return k.indexOf(pre) === 0; }).forEach(function (k) {
    const no = k.slice(pre.length), p = present[no];
    if (p && p.status === '접수완료') return; // 아직 남아 있음
    if (!p) {
      const s = JSON.parse(all[k]), row = studentRow_(sh, s.id);
      if (row && s.after) {
        const v = readRow_(sh, row, width);
        const s1 = pad_(v.slice(1, 1 + c.n1), c.n1), s2 = pad_(v.slice(1 + c.n1, width), c.n2);
        if (same_(s1, s.after.sem1) && same_(s2, s.after.sem2)) {
          sh.getRange(row, 2, 1, c.n1 + c.n2).setValues([pad_(s.before.sem1, c.n1).concat(pad_(s.before.sem2, c.n2))]);
          restored.push(s.id + ' ' + s.name);
        }
      }
    }
    props.deleteProperty(k);
  });
  // 예전에 접수된 기록도 보관본으로 등록
  Object.keys(present).forEach(function (no) {
    const p = present[no];
    if (p.status === '접수완료' && p.after && !all[pre + no]) saveSnap_(grade, p);
  });
  return restored;
}

/** 시트가 바뀔 때마다 자동 실행 (설치형 트리거) */
function onSheetChange(e) {
  const id = e && e.source ? e.source.getId() : '';
  Object.keys(SHEETS).forEach(function (g) {
    if (SHEETS[g].id !== id) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try { reconcile_(g); } finally { lock.releaseLock(); }
  });
}

/** 두 시트에 자동 실행을 걸어 둡니다. 처음 요청 때 한 번 실행되며, 편집기에서 직접 실행해도 됩니다. */
function 자동되돌리기_설치() {
  const have = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'onSheetChange'; })
    .map(function (t) { return t.getTriggerSourceId(); });
  Object.keys(SHEETS).forEach(function (g) {
    if (have.indexOf(SHEETS[g].id) < 0) ScriptApp.newTrigger('onSheetChange').forSpreadsheet(SHEETS[g].id).onChange().create();
  });
  props.setProperty('TRIG_OK', '1');
  return '자동 되돌리기가 설치되었습니다.';
}
function ensureTriggers_() {
  if (props.getProperty('TRIG_OK') === '1') return;
  try { 자동되돌리기_설치(); } catch (e) { /* 권한이 없으면 페이지를 열 때 맞춰 봅니다 */ }
}
