// Cloudflare Worker untuk Rekap SO Mobile
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-app-version',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API Routes
      if (path.startsWith('/api/')) {
        return await handleApiRequest(request, env, path, corsHeaders);
      }

      // Serve static files
      return await serveStaticFile(request, env);

    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ 
        success: false, 
        error: error.message 
      }, 500, corsHeaders);
    }
  }
}

// API Request Handler
async function handleApiRequest(request, env, path, corsHeaders) {
  switch (path) {
    case '/api/rekap':
      if (request.method === 'POST') return await handleRekap(request, env, corsHeaders);
      break;
    case '/api/sheets':
      if (request.method === 'GET') return await handleGetSheets(request, env, corsHeaders);
      break;
    case '/api/check-hpp':
      if (request.method === 'GET') return await handleCheckHPP(request, env, corsHeaders);
      break;
    case '/api/health':
      return jsonResponse({ status: 'ok', version: env.VERSION }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Endpoint not found' }, 404, corsHeaders);
}

// Handler untuk proses rekap
async function handleRekap(request, env, corsHeaders) {
  const { type, hppValues = {}, tanggal, shift, operator } = await request.json();
  
  if (!tanggal || !shift || !operator) {
    throw new Error('Tanggal, shift, dan operator wajib diisi');
  }

  // Ambil data dari worksheet MS
  const msData = await getSheetData(env, 'MS', 'A:H');
  
  if (!msData || msData.length === 0) {
    throw new Error('Tidak ada data ditemukan di worksheet MS');
  }

  const headers = msData[0];
  const dataRows = msData.slice(1);

  // Mapping kolom
  const pluIndex = headers.indexOf('PLU');
  const descpIndex = headers.indexOf('DESCP');
  const c1Index = headers.indexOf('C1');
  const tagIndex = headers.indexOf('TAG');
  const hppIndex = headers.indexOf('HPP');

  const processedData = [];
  const needHppInput = [];

  for (const row of dataRows) {
    if (!row[pluIndex]) continue;

    const plu = row[pluIndex];
    let hpp = parseFloat(row[hppIndex]) || 0;
    
    // Jika HPP = 0, cek input manual
    if (hpp === 0) {
      if (hppValues[plu]) {
        hpp = parseFloat(hppValues[plu]);
        await updateHppInMS(env, plu, hpp);
      } else {
        needHppInput.push({
          plu,
          descp: row[descpIndex] || '',
          hpp: 0
        });
        continue; // Skip item yang butuh input HPP
      }
    }

    processedData.push({
      plu,
      descp: row[descpIndex] || '',
      c1: c1Index !== -1 ? row[c1Index] : '',
      tag: tagIndex !== -1 ? row[tagIndex] : '',
      hpp
    });
  }

  // Jika ada item yang butuh input HPP
  if (needHppInput.length > 0) {
    return jsonResponse({
      success: false,
      needHppInput: needHppInput,
      message: `${needHppInput.length} item membutuhkan input HPP manual`
    }, 200, corsHeaders);
  }

  // Proses rekap berdasarkan type
  const results = {};
  if (type === 'so' || type === 'both') {
    results.rekapSO = await buatRekapSO(env, processedData, { tanggal, shift, operator });
  }
  
  if (type === 'rekonsiliasi' || type === 'both') {
    results.rekapRekonsiliasi = await buatRekapRekonsiliasi(env, processedData, { tanggal, shift, operator });
  }

  return jsonResponse({
    success: true,
    message: `Rekap ${type} berhasil dibuat`,
    data: results
  }, 200, corsHeaders);
}

// Handler untuk get sheets data
async function handleGetSheets(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sheetName = url.searchParams.get('sheetName');
  const range = url.searchParams.get('range') || 'A:Z';

  if (!sheetName) {
    throw new Error('Parameter sheetName diperlukan');
  }

  const data = await getSheetData(env, sheetName, range);
  
  return jsonResponse({
    success: true,
    data: data
  }, 200, corsHeaders);
}

// Handler untuk cek HPP
async function handleCheckHPP(request, env, corsHeaders) {
  const msData = await getSheetData(env, 'MS', 'A:H');
  
  if (!msData || msData.length === 0) {
    throw new Error('Tidak ada data ditemukan di worksheet MS');
  }

  const headers = msData[0];
  const dataRows = msData.slice(1);
  const hppIndex = headers.indexOf('HPP');
  const pluIndex = headers.indexOf('PLU');
  const descpIndex = headers.indexOf('DESCP');

  const zeroHppItems = dataRows
    .filter(row => {
      const hpp = parseFloat(row[hppIndex]) || 0;
      return hpp === 0 && row[pluIndex];
    })
    .map(row => ({
      plu: row[pluIndex],
      descp: row[descpIndex] || '',
      hpp: 0
    }));

  return jsonResponse({
    success: true,
    zeroHppItems: zeroHppItems,
    total: zeroHppItems.length
  }, 200, corsHeaders);
}

// Fungsi untuk buat rekap SO
async function buatRekapSO(env, data, metadata) {
  const dataRekap = [];

  for (const item of data) {
    const idRekap = generateIdRekap(item.plu, metadata.tanggal);
    const stok = await hitungStok(env, item);
    const selisihQty = await hitungSelisihQty(env, item);
    const selisihRp = selisihQty * item.hpp;

    dataRekap.push([
      idRekap,
      metadata.tanggal,
      metadata.operator,
      item.plu,
      item.descp,
      item.c1,
      item.tag,
      stok,
      selisihQty,
      selisihRp,
      new Date().toISOString()
    ]);
  }

  const headers = [
    'ID_REKAP', 'TANGGAL', 'PENGIRIM', 'PLU', 'DESKRIPSI', 'KATEGORI', 
    'TAG', 'STOK', 'SELISIH_QTY', 'SELISIH_RP', 'WAKTU'
  ];

  let existingData;
  try {
    existingData = await getSheetData(env, 'RekapSo', 'A1:K1');
  } catch (error) {
    existingData = null;
  }

  let result;
  if (!existingData || existingData.length === 0) {
    result = await appendToSheet(env, 'RekapSo', [headers, ...dataRekap]);
  } else {
    result = await appendToSheet(env, 'RekapSo', dataRekap);
  }

  return { totalRecords: dataRekap.length, result };
}

// Fungsi untuk buat rekap rekonsiliasi
async function buatRekapRekonsiliasi(env, data, metadata) {
  const dataRekap = [];

  for (const item of data) {
    const idRekap = generateIdRekap(item.plu, metadata.tanggal);
    const stok = await hitungStok(env, item);
    const selisihQty = await hitungSelisihQty(env, item);
    const selisihRp = selisihQty * item.hpp;

    dataRekap.push([
      idRekap,
      metadata.tanggal,
      metadata.operator,
      item.plu,
      item.descp,
      item.c1,
      item.tag,
      stok,
      selisihQty,
      selisihRp
    ]);
  }

  const headers = [
    'ID_REKAP', 'TANGGAL', 'PENGIRIM', 'PLU', 'DESKRIPSI', 'KATEGORI', 
    'TAG', 'STOK', 'SELISIH_QTY', 'SELISIH_RP'
  ];

  let existingData;
  try {
    existingData = await getSheetData(env, 'RekapRekonsiliasi', 'A1:J1');
  } catch (error) {
    existingData = null;
  }

  let result;
  if (!existingData || existingData.length === 0) {
    result = await appendToSheet(env, 'RekapRekonsiliasi', [headers, ...dataRekap]);
  } else {
    result = await appendToSheet(env, 'RekapRekonsiliasi', dataRekap);
  }

  return { totalRecords: dataRekap.length, result };
}

// Helper functions
function generateIdRekap(plu, tanggal) {
  return `REKAP_${plu}_${tanggal}_${Date.now()}`;
}

async function updateHppInMS(env, plu, hppBaru) {
  try {
    const msData = await getSheetData(env, 'MS', 'A:H');
    const headers = msData[0];
    const dataRows = msData.slice(1);

    const pluIndex = headers.indexOf('PLU');
    const hppIndex = headers.indexOf('HPP');

    if (pluIndex === -1 || hppIndex === -1) return;

    for (let i = 0; i < dataRows.length; i++) {
      if (dataRows[i][pluIndex] === plu) {
        const range = `${String.fromCharCode(65 + hppIndex)}${i + 2}`;
        await updateSheetData(env, 'MS', range, [[hppBaru]]);
        break;
      }
    }
  } catch (error) {
    console.error('Error updating HPP:', error);
  }
}

async function hitungStok(env, item) {
  // Implement your stock calculation logic
  return Math.floor(Math.random() * 100) + 1;
}

async function hitungSelisihQty(env, item) {
  // Implement your difference calculation logic
  return Math.floor(Math.random() * 10) - 5;
}

// Google Sheets API functions (sama seperti sebelumnya)
async function getSheetData(env, sheetName, range) {
  const spreadsheetId = env.GOOGLE_SHEETS_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!${range}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${await getAccessToken(env)}` }
  });

  if (!response.ok) throw new Error(`Sheets API error: ${response.statusText}`);
  const data = await response.json();
  return data.values || [];
}

async function appendToSheet(env, sheetName, values) {
  const spreadsheetId = env.GOOGLE_SHEETS_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!A1:append?valueInputOption=RAW`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${await getAccessToken(env)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });

  if (!response.ok) throw new Error(`Sheets API error: ${response.statusText}`);
  return await response.json();
}

async function updateSheetData(env, sheetName, range, values) {
  const spreadsheetId = env.GOOGLE_SHEETS_ID;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${sheetName}!${range}?valueInputOption=RAW`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${await getAccessToken(env)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });

  if (!response.ok) throw new Error(`Sheets API error: ${response.statusText}`);
  return await response.json();
}

// JWT Token functions (sama seperti sebelumnya)
async function getAccessToken(env) {
  const serviceAccount = {
    type: "service_account",
    project_id: env.GOOGLE_PROJECT_ID,
    private_key_id: env.GOOGLE_PRIVATE_KEY_ID,
    private_key: env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: env.GOOGLE_CLIENT_EMAIL,
    client_id: env.GOOGLE_CLIENT_ID,
    token_uri: "https://oauth2.googleapis.com/token"
  };

  // ... (JWT creation logic sama seperti sebelumnya)
  // Untuk singkatnya, saya skip bagian ini karena sama dengan sebelumnya
  return "your-access-token";
}

// Serve static files
async function serveStaticFile(request, env) {
  const url = new URL(request.url);
  let path = url.pathname;

  if (path === '/') path = '/index.html';

  // Get file from KV store or serve from public directory
  const file = await env.ASSETS.fetch(new URL(path, request.url));
  
  if (file.status === 404) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(file.body, {
    headers: {
      'Content-Type': getContentType(path),
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

function getContentType(path) {
  const ext = path.split('.').pop();
  const types = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    ico: 'image/x-icon'
  };
  return types[ext] || 'text/plain';
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}
