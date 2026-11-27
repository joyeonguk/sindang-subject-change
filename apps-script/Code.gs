/**
 * 2027학년도 선택과목 변경 신청 (천안신당고등학교 교육과정부)
 * Google Apps Script 웹앱 - 서버 코드
 *
 * 구성
 *  - 학생 화면 : 배포 URL                (학번·이름·비밀번호로 로그인 → 확인서 + 신청서 작성·제출)
 *  - 교사 화면 : 배포 URL + ?page=teacher (저장소 만들기, 신청 목록, 양식 출력, 상태 처리, 과목별 인원 변동)
 *
 * 데이터
 *  - 과목선택 DB(기존 시트, 읽기 전용) : A열 "학번 이름", B~G 1학기 6과목, H~M 2학기 6과목, O열 비밀번호, P열 과학중점
 *  - 변경신청 저장소(교사 화면에서 새로 만드는 스프레드시트) : '변경신청' 시트에 1인 1행
 */

// ───────── 과목선택 DB 열 위치 (0부터 시작) ─────────
const DB_COL = { NAME: 0, SEM1_FROM: 1, SEM2_FROM: 7, COUNT: 6, PW: 14, SCIENCE: 15 };

// ───────── 2학년 신청 가능 과목 (안내문 「2학년 신청 가능 과목 목록」 기준) ─────────
// tag: 'sci' = 과학 진로(*) 과목, 'pe' = 체육특성화 대상 학생만 선택
const SUBJECTS = {
  1: [
    ['국어', '문학'], ['국어', '독서토론과 글쓰기'],
    ['영어', '영어Ⅰ'],
    ['수학', '대수'],
    ['사회', '사회와 문화'], ['사회', '세계사'], ['사회', '세계시민과 지리'], ['사회', '현대사회와 윤리'],
    ['과학', '물리학'], ['과학', '화학'], ['과학', '생명과학'], ['과학', '지구과학'],
    ['체육', '기초 체육 전공실기', 'pe'],
    ['기술·가정', '로봇과 공학세계'], ['정보', '인공지능기초'],
    ['제2외국어', '일본어'], ['제2외국어', '중국어'], ['한문', '한문']
  ],
  2: [
    ['국어', '독서와 작문'],
    ['영어', '영어Ⅱ'], ['영어', '실생활 영어 회화'],
    ['수학', '미적분Ⅰ'], ['수학', '기하'],
    ['사회', '사회와 문화'], ['사회', '세계사'], ['사회', '세계시민과 지리'], ['사회', '현대사회와 윤리'],
    ['사회', '동아시아 역사기행'], ['사회', '한국지리 탐구'],
    ['과학', '물리학'], ['과학', '화학'], ['과학', '생명과학'], ['과학', '지구과학'],
    ['과학', '전자기와 양자', 'sci'], ['과학', '화학 반응의 세계', 'sci'],
    ['과학', '세포와 물질대사', 'sci'], ['과학', '지구시스템과학', 'sci'],
    ['체육', '고급 체육 전공실기', 'pe'],
    ['기술·가정', '로봇과 공학세계'], ['정보', '인공지능기초'],
    ['제2외국어', '일본어'], ['제2외국어', '중국어'], ['한문', '한문']
  ]
};

const STORE_SHEET = '변경신청';
const HEAD = ['접수일시', '학번', '이름', '과학중점 희망', '체육특성화 희망',
  '확인서(학생)', '확인서(학부모)', '변경내역', '변경내역(JSON)', '변경사유',
  '보호자 성명', '학생 서명', '보호자 서명', '상태', '교사 메모', '처리일시'];
const C = {}; HEAD.forEach(function (h, i) { C[h] = i; });
const STATUSES = ['접수', '상담중', '승인', '반려'];
const MAX_CHANGES = 5;

const props = PropertiesService.getScriptProperties();

// ───────── 웹앱 진입점 ─────────
// 이 웹앱 주소는 GitHub 페이지(index.html)가 데이터를 주고받는 통로입니다.
function doGet() {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">선택과목 변경 신청 데이터 연결 주소입니다. 이 주소를 GitHub 저장소의 config.js에 넣어 사용하세요.</p>')
    .setTitle('선택과목 변경 신청 연결');
}

// GitHub 페이지 → { fn: '함수 이름', args: [...] } → { ok, data | error }
function doPost(e) {
  const API = {
    getPublicConfig: getPublicConfig, studentLogin: studentLogin, submitRequest: submitRequest, cancelRequest: cancelRequest,
    teacherState: teacherState, teacherSetup: teacherSetup, teacherLogin: teacherLogin, teacherData: teacherData,
    teacherDetail: teacherDetail, teacherUpdate: teacherUpdate, teacherSaveSettings: teacherSaveSettings, teacherNewStore: teacherNewStore
  };
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (!API[req.fn]) throw new Error('알 수 없는 요청입니다.');
    out = { ok: true, data: API[req.fn].apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ───────── 공통 도우미 ─────────
function norm_(s) {
  return String(s || '').replace(/\*/g, '').replace(/\s+/g, '')
    .replace(/III$/, 'Ⅲ').replace(/II$/, 'Ⅱ').replace(/I$/, 'Ⅰ');
}
function hash_(pw) {
  const salt = props.getProperty('SALT') || '';
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + String(pw), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(raw);
}
function cfg_() {
  return {
    dbId: props.getProperty('DB_ID'), dbSheet: props.getProperty('DB_SHEET'),
    storeId: props.getProperty('STORE_ID'), start: props.getProperty('START') || '', end: props.getProperty('END') || '',
    configured: !!props.getProperty('TEACHER_PW')
  };
}
function today_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'); }
function inPeriod_() {
  const c = cfg_(), d = today_();
  if (c.start && d < c.start) return '신청 기간이 아닙니다. 신청은 ' + c.start + '부터 가능합니다.';
  if (c.end && d > c.end) return '신청 기간(' + c.start + ' ~ ' + c.end + ')이 끝났습니다. 담임선생님께 문의하세요.';
  return '';
}
function idFromUrl_(s) {
  const m = String(s || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : String(s || '').trim();
}
function storeSheet_() {
  const id = props.getProperty('STORE_ID');
  if (!id) throw new Error('저장소가 아직 없습니다. 교사 화면에서 저장소를 먼저 만들어 주세요.');
  return SpreadsheetApp.openById(id).getSheetByName(STORE_SHEET);
}
function subjectSet_(sem) {
  const m = {};
  SUBJECTS[sem].forEach(function (s) { m[norm_(s[1])] = s; });
  return m;
}

// ───────── 학생 ─────────
function getPublicConfig() {
  const c = cfg_();
  return { configured: c.configured && !!c.storeId, start: c.start, end: c.end, subjects: SUBJECTS, maxChanges: MAX_CHANGES };
}

/** 과목선택 DB에서 학생을 찾아 본인 확인. 실패하면 오류. */
function findStudent_(id, name, pw) {
  id = String(id || '').trim(); name = String(name || '').replace(/\s+/g, ''); pw = String(pw || '').trim();
  if (!/^\d{5}$/.test(id) || !name || !pw) throw new Error('학번(5자리), 이름, 비밀번호를 모두 입력해 주세요.');
  const c = cfg_();
  const sh = SpreadsheetApp.openById(c.dbId).getSheetByName(c.dbSheet);
  const rows = sh.getDataRange().getDisplayValues();
  for (let r = 1; r < rows.length; r++) {
    const key = String(rows[r][DB_COL.NAME]).trim().split(/\s+/);
    if (key[0] !== id) continue;
    if (key.slice(1).join('') !== name || String(rows[r][DB_COL.PW]).trim() !== pw) break;
    return {
      id: id, name: key.slice(1).join(''),
      sem1: rows[r].slice(DB_COL.SEM1_FROM, DB_COL.SEM1_FROM + DB_COL.COUNT).filter(String),
      sem2: rows[r].slice(DB_COL.SEM2_FROM, DB_COL.SEM2_FROM + DB_COL.COUNT).filter(String),
      science: rows[r][DB_COL.SCIENCE] || ''
    };
  }
  throw new Error('학번, 이름, 비밀번호가 과목선택 때 등록한 정보와 맞지 않습니다. 비밀번호를 잊었다면 담임선생님께 문의하세요.');
}

function findRequestRow_(sh, id) {
  const ids = sh.getRange(1, C['학번'] + 1, sh.getLastRow(), 1).getDisplayValues();
  for (let r = 1; r < ids.length; r++) if (String(ids[r][0]) === String(id)) return r + 1;
  return 0;
}

function rowToRequest_(v, withSign) {
  return {
    time: v[C['접수일시']], id: String(v[C['학번']]), name: v[C['이름']],
    science: v[C['과학중점 희망']], pe: v[C['체육특성화 희망']],
    agreeStudent: v[C['확인서(학생)']], agreeParent: v[C['확인서(학부모)']],
    summary: v[C['변경내역']], changes: JSON.parse(v[C['변경내역(JSON)']] || '[]'), reason: v[C['변경사유']],
    guardian: v[C['보호자 성명']],
    signStudent: withSign ? v[C['학생 서명']] : '', signParent: withSign ? v[C['보호자 서명']] : '',
    status: v[C['상태']], memo: v[C['교사 메모']], doneAt: v[C['처리일시']]
  };
}

function studentLogin(id, name, pw) {
  const p = inPeriod_(); if (p) throw new Error(p);
  const st = findStudent_(id, name, pw);
  const sh = storeSheet_(), r = findRequestRow_(sh, st.id);
  st.request = r ? rowToRequest_(sh.getRange(r, 1, 1, HEAD.length).getDisplayValues()[0], false) : null;
  return st;
}

function submitRequest(id, name, pw, f) {
  const p = inPeriod_(); if (p) throw new Error(p);
  const st = findStudent_(id, name, pw);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = storeSheet_(), r = findRequestRow_(sh, st.id);
    if (r) {
      const status = sh.getRange(r, C['상태'] + 1).getValue();
      if (status !== '접수') throw new Error('이미 「' + status + '」 단계로 처리 중이라 수정할 수 없습니다. 담임선생님께 문의하세요.');
    }
    // 확인서 : 모든 문항 '예'
    if (!f.agreeStudent || f.agreeStudent.length !== 6 || f.agreeStudent.some(function (a) { return a !== '예'; }) ||
        !f.agreeParent || f.agreeParent.length !== 5 || f.agreeParent.some(function (a) { return a !== '예'; })) {
      throw new Error('확인서의 모든 문항에 「예」로 답해야 신청할 수 있습니다.');
    }
    // 변경 내역 검증
    const ch = (f.changes || []).filter(function (c) { return c && c.from && c.to; });
    if (!ch.length) throw new Error('변경할 과목을 1개 이상 입력해 주세요.');
    if (ch.length > MAX_CHANGES) throw new Error('변경은 최대 ' + MAX_CHANGES + '건까지 신청할 수 있습니다.');
    const after = { 1: st.sem1.map(norm_), 2: st.sem2.map(norm_) };
    ch.forEach(function (c) {
      const sem = Number(c.sem), list = after[sem], avail = subjectSet_(sem);
      if (!list) throw new Error('학기를 선택해 주세요.');
      const i = list.indexOf(norm_(c.from));
      if (i < 0) throw new Error(sem + '학기 「' + c.from + '」은(는) 기존 선택 과목이 아닙니다.');
      const s = avail[norm_(c.to)];
      if (!s) throw new Error(sem + '학기에 「' + c.to + '」은(는) 개설되지 않습니다.');
      if (s[2] === 'pe' && f.pe !== 'O') throw new Error('「' + c.to + '」은(는) 체육특성화 대상 학생만 선택할 수 있습니다.');
      if (list.indexOf(norm_(c.to)) >= 0) throw new Error(sem + '학기에 「' + c.to + '」이(가) 이미 있습니다.');
      list[i] = norm_(c.to);
    });
    if (String(f.reason || '').trim().length < 20) throw new Error('변경 사유를 20자 이상 구체적으로 적어 주세요.');
    if (!String(f.guardian || '').trim()) throw new Error('보호자 성명을 입력해 주세요.');
    if (!/^data:image\/png;base64,/.test(f.signStudent || '') || !/^data:image\/png;base64,/.test(f.signParent || '')) {
      throw new Error('학생과 보호자 서명이 모두 필요합니다.');
    }
    const summary = ch.map(function (c) { return c.sem + '학기 ' + c.from + ' → ' + c.to; }).join('\n');
    const row = [now_(), st.id, st.name, f.science === 'O' ? 'O' : 'X', f.pe === 'O' ? 'O' : 'X',
      f.agreeStudent.join(','), f.agreeParent.join(','), summary, JSON.stringify(ch), String(f.reason).trim(),
      String(f.guardian).trim(), f.signStudent, f.signParent, '접수', '', ''];
    if (r) sh.getRange(r, 1, 1, HEAD.length).setValues([row]); else sh.appendRow(row);
    return { time: row[0], summary: summary };
  } finally { lock.releaseLock(); }
}

function cancelRequest(id, name, pw) {
  const st = findStudent_(id, name, pw);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = storeSheet_(), r = findRequestRow_(sh, st.id);
    if (!r) return true;
    if (sh.getRange(r, C['상태'] + 1).getValue() !== '접수') throw new Error('이미 처리가 시작되어 취소할 수 없습니다. 담임선생님께 문의하세요.');
    sh.deleteRow(r);
    return true;
  } finally { lock.releaseLock(); }
}

// ───────── 교사 ─────────
function teacherState() {
  const c = cfg_();
  return { configured: c.configured };
}

/** 처음 한 번 : 교사 비밀번호 설정 + DB 연결 + 저장소(새 스프레드시트) 생성 */
function teacherSetup(f) {
  if (props.getProperty('TEACHER_PW')) throw new Error('이미 설정되어 있습니다. 교사 로그인 후 설정 탭을 이용하세요.');
  if (String(f.pw || '').length < 6) throw new Error('교사 비밀번호는 6자 이상으로 정해 주세요.');
  const dbId = idFromUrl_(f.dbUrl);
  let db;
  try { db = SpreadsheetApp.openById(dbId); } catch (err) { throw new Error('과목선택 DB 주소를 열 수 없습니다. 주소와 공유 권한을 확인해 주세요.'); }
  const dbSheet = String(f.dbSheet || '').trim();
  if (!db.getSheetByName(dbSheet)) throw new Error('DB에 「' + dbSheet + '」 시트가 없습니다. 시트 이름: ' + db.getSheets().map(function (s) { return s.getName(); }).join(', '));
  props.setProperty('SALT', Utilities.getUuid());
  props.setProperties({ TEACHER_PW: hash_(f.pw), DB_ID: dbId, DB_SHEET: dbSheet, START: f.start || '', END: f.end || '' });
  const url = createStore_();
  return { token: newToken_(), storeUrl: url };
}

function createStore_() {
  const ss = SpreadsheetApp.create('2027 선택과목 변경 신청 저장소');
  const sh = ss.getSheets()[0].setName(STORE_SHEET);
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#e8eef6');
  sh.setFrozenRows(1);
  sh.getRange('B:B').setNumberFormat('@');
  sh.setColumnWidth(C['변경내역'] + 1, 260); sh.setColumnWidth(C['변경사유'] + 1, 320);
  sh.hideColumns(C['변경내역(JSON)'] + 1);
  sh.getRange(2, C['상태'] + 1, 999, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  props.setProperty('STORE_ID', ss.getId());
  return ss.getUrl();
}

function newToken_() {
  const t = Utilities.getUuid();
  CacheService.getScriptCache().put('T_' + t, '1', 21600);
  return t;
}
function checkToken_(t) {
  if (!t || !CacheService.getScriptCache().get('T_' + t)) throw new Error('로그인 시간이 지났습니다. 다시 로그인해 주세요.');
}

function teacherLogin(pw) {
  if (!props.getProperty('TEACHER_PW')) throw new Error('아직 설정되지 않았습니다.');
  if (hash_(pw) !== props.getProperty('TEACHER_PW')) throw new Error('교사 비밀번호가 맞지 않습니다.');
  return newToken_();
}

function teacherData(token) {
  checkToken_(token);
  const c = cfg_();
  const sh = storeSheet_();
  const v = sh.getDataRange().getDisplayValues();
  const list = v.slice(1).filter(function (r) { return r[C['학번']]; }).map(function (r) { return rowToRequest_(r, false); });
  // 과목별 현재 인원 (DB 기준)
  const rows = SpreadsheetApp.openById(c.dbId).getSheetByName(c.dbSheet).getDataRange().getDisplayValues().slice(1);
  const count = { 1: {}, 2: {} };
  rows.forEach(function (r) {
    if (!r[DB_COL.NAME]) return;
    [1, 2].forEach(function (sem) {
      const from = sem === 1 ? DB_COL.SEM1_FROM : DB_COL.SEM2_FROM;
      r.slice(from, from + DB_COL.COUNT).forEach(function (s) { if (s) count[sem][norm_(s)] = (count[sem][norm_(s)] || 0) + 1; });
    });
  });
  return {
    list: list, count: count, subjects: SUBJECTS, totalStudents: rows.filter(function (r) { return r[DB_COL.NAME]; }).length,
    settings: { start: c.start, end: c.end, storeUrl: c.storeId ? SpreadsheetApp.openById(c.storeId).getUrl() : '', dbSheet: c.dbSheet }
  };
}

function teacherDetail(token, id) {
  checkToken_(token);
  const sh = storeSheet_(), r = findRequestRow_(sh, id);
  if (!r) throw new Error('신청을 찾을 수 없습니다.');
  const req = rowToRequest_(sh.getRange(r, 1, 1, HEAD.length).getDisplayValues()[0], true);
  // 기존 과목도 함께
  const c = cfg_();
  const rows = SpreadsheetApp.openById(c.dbId).getSheetByName(c.dbSheet).getDataRange().getDisplayValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][DB_COL.NAME]).trim().split(/\s+/)[0] === String(id)) {
      req.sem1 = rows[i].slice(DB_COL.SEM1_FROM, DB_COL.SEM1_FROM + DB_COL.COUNT).filter(String);
      req.sem2 = rows[i].slice(DB_COL.SEM2_FROM, DB_COL.SEM2_FROM + DB_COL.COUNT).filter(String);
      break;
    }
  }
  return req;
}

function teacherUpdate(token, id, status, memo) {
  checkToken_(token);
  if (STATUSES.indexOf(status) < 0) throw new Error('상태 값이 올바르지 않습니다.');
  const sh = storeSheet_(), r = findRequestRow_(sh, id);
  if (!r) throw new Error('신청을 찾을 수 없습니다.');
  const t = now_();
  sh.getRange(r, C['상태'] + 1, 1, 3).setValues([[status, String(memo || ''), t]]);
  return { status: status, memo: memo, doneAt: t };
}

function teacherSaveSettings(token, f) {
  checkToken_(token);
  props.setProperties({ START: f.start || '', END: f.end || '' });
  if (f.newPw) {
    if (String(f.newPw).length < 6) throw new Error('새 비밀번호는 6자 이상이어야 합니다.');
    props.setProperty('TEACHER_PW', hash_(f.newPw));
  }
  return true;
}

/** 저장소를 지웠거나 새 학기용으로 다시 만들 때 */
function teacherNewStore(token) {
  checkToken_(token);
  return createStore_();
}
