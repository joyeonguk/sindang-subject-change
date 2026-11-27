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
    const fn = { ping: ping, load: load, save: save, apply: apply }[q.fn];
    if (!fn) throw new Error('알 수 없는 요청입니다.');
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
function ping(q) { cfg_(q.grade); return { grade: q.grade, tab: cfg_(q.grade).tab }; }

/** 학생 전체(학번순)와 변경 기록 */
function load(q) {
  const c = cfg_(q.grade), sh = db_(q.grade), last = sh.getLastRow();
  const width = Math.max(1 + c.n1 + c.n2, c.sciCol || 0);
  const v = last > 1 ? sh.getRange(2, 1, last - 1, width).getDisplayValues() : [];
  const byId = {};
  v.forEach(function (r, i) {
    const m = String(r[0] || '').trim().match(/^(\d{5})\s*(.+)$/);
    if (!m) return;
    byId[m[1]] = { id: m[1], name: m[2].trim(), row: i + 2,
      raw1: pad_(r.slice(1, 1 + c.n1), c.n1), raw2: pad_(r.slice(1 + c.n1, 1 + c.n1 + c.n2), c.n2),
      science: c.sciCol ? String(r[c.sciCol - 1] || '').trim() : '' };
  });
  const lg = log_(q.grade), ln = lg.getLastRow();
  const lv = ln > 1 ? lg.getRange(2, 1, ln - 1, LOG_HEAD.length).getDisplayValues() : [];
  return {
    students: Object.keys(byId).sort().map(function (k) { return byId[k]; }),
    requests: lv.map(function (r, i) { return r[0] ? fromRow_(r, i + 2) : null; }).filter(Boolean)
  };
}

/** 작성 저장 / 출력(처리중) / 취소 */
function save(q) {
  const t = teacher_(q), r = q.req, lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const lg = log_(q.grade);
    if (!r.logRow) {
      const ln = lg.getLastRow();
      if (ln > 1) {
        const open = lg.getRange(2, 1, ln - 1, LOG_HEAD.length).getDisplayValues().filter(function (v) {
          return String(v[L['학번']]) === String(r.id) && (v[L['상태']] === '작성' || v[L['상태']] === '처리중');
        })[0];
        if (open) throw new Error('이 학생은 ' + (open[L['작성 선생님']] || '다른') + ' 선생님이 이미 작성 중입니다. 새로고침해 주세요.');
      }
      r.createdBy = t;
    }
    if (q.printing) { r.printedBy = t; r.printedAt = now_(); }
    if (r.status === '취소') r.doneBy = t;
    if (r.logRow) lg.getRange(r.logRow, 1, 1, LOG_HEAD.length).setValues([toRow_(r)]);
    else { lg.appendRow(toRow_(r)); r.logRow = lg.getLastRow(); }
    return r;
  } finally { lock.releaseLock(); }
}

/** 서명본 접수 완료: DB 행의 과목 칸을 바꾸고 기록을 접수완료로 */
function apply(q) {
  const t = teacher_(q), r = q.req, c = cfg_(q.grade), lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = db_(q.grade), width = 1 + c.n1 + c.n2;
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
    log_(q.grade).getRange(r.logRow, 1, 1, LOG_HEAD.length).setValues([toRow_(r)]);
    return r;
  } finally { lock.releaseLock(); }
}
