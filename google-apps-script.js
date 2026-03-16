// ═══════════════════════════════════════════════════════════════
//  FACEATTEND PRO — Google Apps Script Backend
//  Paste ALL of this into https://script.google.com
//  Then Deploy → Web App → Anyone → Deploy
// ═══════════════════════════════════════════════════════════════

// ▶▶ STEP 1: Replace with your Google Sheet ID
// (from URL: docs.google.com/spreadsheets/d/ *** THIS PART *** /edit)
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';

// Sheet tab names
const SHEET_ATTENDANCE = 'Attendance';
const SHEET_SUMMARY    = 'Daily Summary';
const SHEET_STUDENTS   = 'Students';

// ── POST handler (called by FaceAttend app) ───────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let result;
    switch (data.action) {
      case 'markAttendance': result = handleMarkAttendance(data); break;
      case 'syncStudent':    result = handleSyncStudent(data);    break;
      default: result = { success: false, message: 'Unknown action: ' + data.action };
    }
    return respond(result);
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

// ── GET handler (for testing) ─────────────────────────────────
function doGet(e) {
  return respond({ status: 'FaceAttend Pro API ✓', time: new Date().toISOString(), sheetId: SHEET_ID });
}

// ── MARK ATTENDANCE ───────────────────────────────────────────
function handleMarkAttendance(data) {
  const ss   = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreate(ss, SHEET_ATTENDANCE);

  // Create headers if new sheet
  if (sheet.getLastRow() === 0) {
    const headers = ['Date', 'Time', 'Student ID', 'Student Name', 'Class', 'Method', 'Timestamp'];
    sheet.appendRow(headers);
    styleHeader(sheet, headers.length);
  }

  // Check for duplicate (same student, same date)
  const today   = data.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (const row of existing) {
      if (String(row[0]) === today && String(row[2]) === data.id) {
        return { success: false, message: 'Duplicate: already marked today', duplicate: true };
      }
    }
  }

  // Append new row
  sheet.appendRow([
    data.date      || today,
    data.time      || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'),
    data.id        || '',
    data.name      || '',
    data.class     || '',
    data.method    || 'face',
    data.timestamp || new Date().toISOString(),
  ]);

  // Zebra stripe
  const newRow = sheet.getLastRow();
  if (newRow % 2 === 0) sheet.getRange(newRow, 1, 1, 7).setBackground('#F8F9FA');

  // Color-code method column
  const methodCell = sheet.getRange(newRow, 6);
  if (data.method === 'qr') {
    methodCell.setBackground('#EDE9FE').setFontColor('#5B21B6');
  } else {
    methodCell.setBackground('#ECFDF5').setFontColor('#065F46');
  }

  updateDailySummary(ss, data.date || today, data.method);

  return { success: true, message: 'Recorded', row: newRow };
}

// ── DAILY SUMMARY ─────────────────────────────────────────────
function updateDailySummary(ss, date, method) {
  const sheet = getOrCreate(ss, SHEET_SUMMARY);
  if (sheet.getLastRow() === 0) {
    const headers = ['Date', 'Total Present', 'Face Count', 'QR Count', 'Last Updated'];
    sheet.appendRow(headers);
    styleHeader(sheet, headers.length);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === date) {
        const total    = Number(rows[i][1]) + 1;
        const faceCount = Number(rows[i][2]) + (method === 'face' ? 1 : 0);
        const qrCount   = Number(rows[i][3]) + (method === 'qr'   ? 1 : 0);
        sheet.getRange(i + 2, 2).setValue(total);
        sheet.getRange(i + 2, 3).setValue(faceCount);
        sheet.getRange(i + 2, 4).setValue(qrCount);
        sheet.getRange(i + 2, 5).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'));
        return;
      }
    }
  }

  sheet.appendRow([
    date,
    1,
    method === 'face' ? 1 : 0,
    method === 'qr'   ? 1 : 0,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss')
  ]);
}

// ── HELPER: Get or create sheet tab ──────────────────────────
function getOrCreate(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── HELPER: Style header row ─────────────────────────────────
function styleHeader(sheet, colCount) {
  const range = sheet.getRange(1, 1, 1, colCount);
  range.setFontWeight('bold')
       .setFontColor('#FFFFFF')
       .setBackground('#0D1117')
       .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, colCount, 140);
}

// ── HELPER: JSON response ─────────────────────────────────────
function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
