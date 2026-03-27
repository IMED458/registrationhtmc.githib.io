var DEFAULT_SHEET_SETTINGS = {
  googleSheetsId: 'https://docs.google.com/spreadsheets/d/1zsuLPC1hDVJ1pzGMsk_LY1bILCF6Dbd7/edit?gid=226530235#gid=226530235',
  googleAppsScriptUrl: '',
  googleDriveFolderId: '',
  sheetName: '',
  sheetGid: '',
  disabledEmails: [],
  columnMapping: {
    firstName: 'C',
    lastName: 'B',
    historyNumber: 'F',
    personalId: 'D',
    birthDate: '',
    insurance: 'E',
    phone: '',
    address: '',
  },
};

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    var settings = mergeSystemSettings_(payload.settings);
    var historyNumber = normalizeLookupValue_(payload.historyNumber);
    var personalId = normalizeLookupValue_(payload.personalId);
    var icdCode = normalizeLookupValue_(payload.icdCode);
    var requestedAction = normalizeLookupValue_(payload.requestedAction);
    var department = normalizeLookupValue_(payload.department);
    var consentStatus = normalizeLookupValue_(payload.consentStatus);

    if ((!historyNumber && !personalId) || !icdCode) {
      return jsonResponse_({
        status: 'error',
        message: 'History number or personal ID and ICD code are required',
      });
    }

    return jsonResponse_(
      updateSheetRequestData_(
        settings,
        historyNumber,
        personalId,
        icdCode,
        requestedAction,
        department,
        consentStatus
      )
    );
  } catch (error) {
    return jsonResponse_({
      status: 'error',
      message: String(error && error.message ? error.message : error),
    });
  }
}

function parsePayload_(e) {
  if (!e || !e.postData) {
    return {};
  }

  if (e.postData.type && e.postData.type.indexOf('application/json') >= 0) {
    return JSON.parse(e.postData.contents || '{}');
  }

  var payload = Object.assign({}, e.parameter || {});

  if (payload.settings) {
    try {
      payload.settings = JSON.parse(payload.settings);
    } catch (error) {
      payload.settings = {};
    }
  }

  return payload;
}

function mergeSystemSettings_(input) {
  return Object.assign({}, DEFAULT_SHEET_SETTINGS, input || {}, {
    columnMapping: Object.assign({}, DEFAULT_SHEET_SETTINGS.columnMapping, (input && input.columnMapping) || {}),
  });
}

function extractSpreadsheetId_(value) {
  var trimmedValue = String(value || '').trim();
  var match = trimmedValue.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmedValue;
}

function normalizeLookupValue_(value) {
  return String(value || '').trim();
}

function isRefusalStatus_(value) {
  return normalizeLookupValue_(value).indexOf('უარი') === 0;
}

function getSheetDepartmentValue_(requestedAction, department, consentStatus) {
  if (isRefusalStatus_(consentStatus)) {
    return 'ბინა უარი';
  }

  if (normalizeLookupValue_(department)) {
    return normalizeLookupValue_(department);
  }

  if (normalizeLookupValue_(requestedAction) === 'ბინა') {
    return 'ბინა';
  }

  return '';
}

function prioritizeSheetNames_(sheetNames, preferredSheetName) {
  var normalizedPreferredSheetName = String(preferredSheetName || '').trim();

  if (!normalizedPreferredSheetName || sheetNames.indexOf(normalizedPreferredSheetName) === -1) {
    return sheetNames;
  }

  return [normalizedPreferredSheetName].concat(
    sheetNames.filter(function(sheetName) {
      return sheetName !== normalizedPreferredSheetName;
    })
  );
}

function columnLetterToIndex_(columnName) {
  var normalizedColumnName = String(columnName || '').trim().toUpperCase();

  if (!/^[A-Z]+$/.test(normalizedColumnName)) {
    return -1;
  }

  var index = 0;
  normalizedColumnName.split('').forEach(function(character) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  });

  return index - 1;
}

function findPatientRowNumber_(rows, settings, historyNumber, personalId) {
  if (!rows || rows.length < 2) {
    return null;
  }

  var historyNumberIndex = columnLetterToIndex_(settings.columnMapping.historyNumber || 'F');
  var personalIdIndex = columnLetterToIndex_(settings.columnMapping.personalId || 'D');
  var normalizedHistoryNumber = normalizeLookupValue_(historyNumber);
  var normalizedPersonalId = normalizeLookupValue_(personalId);

  for (var rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    var row = rows[rowIndex];
    var rowHistoryNumber = normalizeLookupValue_(row[historyNumberIndex]);
    var rowPersonalId = normalizeLookupValue_(row[personalIdIndex]);

    if (
      (normalizedHistoryNumber && rowHistoryNumber === normalizedHistoryNumber) ||
      (normalizedPersonalId && rowPersonalId === normalizedPersonalId)
    ) {
      return rowIndex + 1;
    }
  }

  return null;
}

function updateSheetRequestData_(settings, historyNumber, personalId, icdCode, requestedAction, department, consentStatus) {
  var spreadsheet = SpreadsheetApp.openById(extractSpreadsheetId_(settings.googleSheetsId));
  var orderedSheetNames = prioritizeSheetNames_(
    spreadsheet.getSheets().map(function(sheet) {
      return sheet.getName();
    }),
    settings.sheetName
  );

  for (var index = 0; index < orderedSheetNames.length; index += 1) {
    var sheetName = orderedSheetNames[index];
    var sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      continue;
    }

    var rows = sheet.getDataRange().getDisplayValues();
    var rowNumber = findPatientRowNumber_(rows, settings, historyNumber, personalId);

    if (!rowNumber) {
      continue;
    }

    var diagnosisValue = normalizeLookupValue_(icdCode);
    var departmentValue = getSheetDepartmentValue_(requestedAction, department, consentStatus);

    sheet.getRange('H' + rowNumber + ':I' + rowNumber).setValues([[diagnosisValue, departmentValue]]);

    return {
      status: 'ok',
      rowNumber: rowNumber,
      sheetName: sheetName,
      diagnosisValue: diagnosisValue,
      departmentValue: departmentValue,
    };
  }

  throw new Error('Patient row not found for sheet update');
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
