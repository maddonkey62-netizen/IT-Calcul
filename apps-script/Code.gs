/**
 * Diffusion Rate 계산기 — Google Sheets 저장용 Apps Script 웹앱
 *
 * 이 코드를 Google Sheets 의 [확장 프로그램] → [Apps Script] 에 붙여 넣고
 * 웹앱으로 배포한다 (실행: 나, 액세스: 모든 사용자). 시트는 처음 호출 때 자동으로 만들어진다.
 */

var SHEET_RECORDS = '시험기록';
var SHEET_LOG = '변경이력';
var SHEET_SETTINGS = '설정';

// 앱의 toSheetRow() 와 같은 순서·이름이어야 한다
var HEADERS = [
  'id', 'test_at', 'volume_ml', 'test_pressure', 'test_pressure_unit',
  'stabilization_min', 'measure_min', 'dp', 'dp_unit', 'patm', 'patm_unit',
  'temp_correction', 't_test_c', 't_ref_c', 'wetting_fluid', 'note',
  'dp_kpa', 'patm_kpa', 'temp_factor', 'diffusion_ml_min', 'diffusion_ml_hr',
  'deleted', 'created_at', 'updated_at', 'device_id', 'calc_version', 'app_version'
];
// 문자열 그대로 보관할 열 (날짜로 자동 변환되면 수정 시각 비교가 틀어진다)
var TEXT_COLUMNS = ['id', 'created_at', 'updated_at', 'device_id'];
var LOG_HEADERS = ['logged_at', 'record_id', 'action', 'device_id', 'before', 'after'];

function doGet() {
  return json_({ ok: true, app: 'diffusion-rate', fluids: readFluids_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: '서버가 바쁩니다. 잠시 후 다시 시도합니다' });
  }
  try {
    ensureSheets_();
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'ping') return json_({ ok: true, fluids: readFluids_() });
    if (body.action !== 'sync') return json_({ ok: false, error: '알 수 없는 요청: ' + body.action });

    var results = (body.ops || []).map(function (op) {
      try {
        if (op.type === 'upsert' || op.type === 'delete') upsert_(op.record, op.type, op.deviceId);
        else if (op.type === 'setFluids') writeFluids_(op.fluids, op.deviceId);
        else throw new Error('알 수 없는 작업: ' + op.type);
        return { opId: op.opId, ok: true };
      } catch (err) {
        return { opId: op.opId, ok: false, error: String(err && err.message || err) };
      }
    });
    return json_({ ok: true, results: results, fluids: readFluids_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** 처음 실행할 때 시트와 머리글을 만든다. 편집기에서 직접 실행해도 된다. */
function setup() {
  ensureSheets_();
}

function ensureSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var rec = ss.getSheetByName(SHEET_RECORDS) || ss.insertSheet(SHEET_RECORDS, 0);
  if (rec.getLastRow() === 0) {
    rec.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    rec.setFrozenRows(1);
    TEXT_COLUMNS.forEach(function (name) {
      rec.getRange(1, HEADERS.indexOf(name) + 1, rec.getMaxRows(), 1).setNumberFormat('@');
    });
    rec.getRange(2, HEADERS.indexOf('test_at') + 1, rec.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }

  var log = ss.getSheetByName(SHEET_LOG) || ss.insertSheet(SHEET_LOG);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    log.setFrozenRows(1);
  }

  var set = ss.getSheetByName(SHEET_SETTINGS) || ss.insertSheet(SHEET_SETTINGS);
  if (set.getLastRow() === 0) {
    set.getRange(1, 1).setValue('wetting_fluid').setFontWeight('bold');
    set.setFrozenRows(1);
  }
}

/** id 로 행을 찾아 더 새로운 경우에만 덮어쓴다. 같은 작업이 두 번 와도 행은 하나. */
function upsert_(record, action, deviceId) {
  if (!record || !record.id) throw new Error('기록 id 없음');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
  var row = findRow_(sheet, record.id);
  var values = HEADERS.map(function (h) { return cell_(h, record[h]); });

  if (row === -1) {
    sheet.appendRow(values);
    log_(record.id, action === 'delete' ? 'delete' : 'create', deviceId, null, record);
    return;
  }

  var range = sheet.getRange(row, 1, 1, HEADERS.length);
  var before = rowToObject_(range.getValues()[0]);
  // 이미 같거나 더 새로운 내용이 있으면 건너뛴다 (재전송·늦게 도착한 작업)
  if (String(before.updated_at) >= String(record.updated_at)) return;
  range.setValues([values]);
  log_(record.id, action === 'delete' ? 'delete' : 'update', deviceId, before, record);
}

function findRow_(sheet, id) {
  if (sheet.getLastRow() < 2) return -1;
  var found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  return found ? found.getRow() : -1;
}

function rowToObject_(values) {
  var o = {};
  HEADERS.forEach(function (h, i) { o[h] = values[i]; });
  return o;
}

function cell_(header, value) {
  if (value === undefined || value === null) return '';
  if (header === 'test_at') return new Date(value);
  return safeText_(value);
}

/** '=' 등으로 시작하는 글자가 수식으로 실행되지 않게 막는다 */
function safeText_(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function log_(recordId, action, deviceId, before, after) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOG);
  sheet.appendRow([
    new Date(), recordId, action, deviceId || '',
    before ? JSON.stringify(before).slice(0, 45000) : '',
    after ? JSON.stringify(after).slice(0, 45000) : ''
  ]);
}

function readFluids_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
    .map(function (r) { return String(r[0]).trim(); })
    .filter(function (v) { return v; });
}

function writeFluids_(fluids, deviceId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  var before = readFluids_();
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
  var list = (fluids || []).map(function (f) { return [safeText_(String(f))]; });
  if (list.length) sheet.getRange(2, 1, list.length, 1).setValues(list);
  log_('-', 'set_fluids', deviceId, before, fluids);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
