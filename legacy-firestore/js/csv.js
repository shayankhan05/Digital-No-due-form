// RFC-style quoted fields, escaped quotes and embedded newlines. No UID/USN fallback.
export function parseCSV(text, requiredHeaders = ["uid","name","usn","email","semester","section","mentorId"]) {
  const rows = []; let row = [], cell = "", quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else { if (closed || cell.trim()) throw new Error("Malformed CSV quotation."); cell = ""; quoted = true; }
    }
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ""; closed = false; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; closed = false; }
    else if (closed && !quoted) { if (!/\s/.test(c)) throw new Error("Unexpected text after a quoted CSV field."); }
    else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error("CSV headers must be unique and nonblank.");
  for (const key of requiredHeaders) if (!headers.includes(key)) throw new Error(`Missing CSV header: ${key}`);
  return rows.map((values,index) => { if (values.length !== headers.length) throw new Error(`CSV row ${index+2} has the wrong number of columns.`); return Object.fromEntries(headers.map((key,i) => [key,values[i]])); });
}
