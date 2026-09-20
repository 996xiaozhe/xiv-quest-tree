/**
 * Minimal streaming RFC4180 CSV reader for the ffxiv-datamining CSV dumps.
 *
 * The dumps look like:
 *   line 1: key,0,1,2,...            <- column indices
 *   line 2: #,Name,Id,Expansion,...  <- column names (may contain blanks)
 *   line 3: int32,str,str,...        <- column types
 *   line 4+: data
 *
 * Multi-line quoted fields are supported.
 */
import { createReadStream } from 'node:fs';

export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // skip
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Streams a datamining CSV and yields `{ key, get(colName), raw }` for every data row.
 * `columns` is the ordered list of (non-blank) column names, blank headers become `_blankN`.
 */
export async function* readDataminingCsv(file) {
  const stream = createReadStream(file, { encoding: 'utf8' });
  let buf = '';
  let phase = 0; // 0 = header, 1 = names, 2 = types, 3 = data
  let headers = null;
  let index = null;
  let pending = '';

  const parseLine = (line) => parseCsvText(line + '\n')[0] || [];

  for await (const chunk of stream) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      // handle quoted newlines by simply joining until quotes balance
      if ((line.match(/"/g) || []).length % 2 === 1) {
        pending += line + '\n';
        continue;
      }
      if (pending) {
        line = pending + line;
        pending = '';
      }
      if (phase === 0) {
        index = parseLine(line);
        phase = 1;
      } else if (phase === 1) {
        const names = parseLine(line);
        let blank = 0;
        headers = names.map((n, i) => (n && n.trim() ? n.trim() : `_blank${i}`));
        // ignore the trailing empty column that some dumps have
        void blank;
        void index;
        phase = 2;
      } else if (phase === 2) {
        phase = 3;
      } else {
        if (!line.length) continue;
        const cells = parseLine(line);
        const rec = { key: Number(cells[0]), raw: cells };
        rec.get = (name) => {
          const i = headers.indexOf(name);
          return i < 0 ? undefined : cells[i];
        };
        rec.num = (name) => {
          const v = rec.get(name);
          const n = Number(v);
          return v === '' || v === undefined || Number.isNaN(n) ? 0 : n;
        };
        yield rec;
      }
    }
  }
  if (pending) {
    const line = pending;
    const cells = parseLine(line);
    if (phase === 3 && line.length) {
      const rec = { key: Number(cells[0]), raw: cells };
      rec.get = (name) => {
        const i = headers.indexOf(name);
        return i < 0 ? undefined : cells[i];
      };
      rec.num = (name) => {
        const v = rec.get(name);
        const n = Number(v);
        return v === '' || v === undefined || Number.isNaN(n) ? 0 : n;
      };
      yield rec;
    }
  }
}

/** Reads a whole datamining CSV into an array of records. */
export async function loadDataminingCsv(file) {
  const out = [];
  for await (const rec of readDataminingCsv(file)) out.push(rec);
  return out;
}
