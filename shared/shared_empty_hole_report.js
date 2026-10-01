/* ══════════════════════════════════════════════════════════════════════════
   LAPORAN LUBANG KOSONG SELEPAS TANAM — the paper form, drawn

   The nursery has audited empty holes on paper for years: one sheet per
   batch, a table per tray, a tick box per hole for the auditor to sign off
   in the field. When an empty-hole case goes to Nelos the auditor needs that
   same sheet, and typing it out again from the screen is how a row gets
   missed.

   So it is drawn here, from the batch's own records, and attached to the
   case as a picture. The layout follows the paper exactly — same headings,
   same column order, same tick box — because the point is that an auditor
   can print it and work from it without being taught a new form.

   A PICTURE rather than a PDF: Nelos attaches a photo to a case and shows it
   inline, which is what somebody opening the case on a phone wants. The
   document slot beside it is for things that arrive as files.

   Everything on it comes from the batch: the number, the breed, the actual
   seeds planted, and the holes themselves. The date is the day the case is
   opened, because that is the day the audit is being asked for.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* The paper is A4 portrait. 1240 across is A4 at 150dpi, which is enough to
     print from and small enough to attach; the height follows the content,
     because a batch with forty holes is not going to fit a page anyway and a
     picture that scrolls beats a picture that is cut off. Drawn at twice
     that and scaled, so the hairlines and the small print survive. */
  const W = 1240;
  const SCALE = 2;
  const PAD = 70;              // the margin the paper has
  const SERIF = '"Times New Roman", Times, serif';
  const PINK = '#f6d5d8';      // the header band on the paper form
  const LINE = '#111111';

  /* "1 October 2026" — the way the form writes a date, and the way the
     nursery reads one. Not the ISO form: this is a sheet for a person. */
  function longDate(iso) {
    const s = String(iso || '').slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return s;
    return `${d.getDate()} ${['January','February','March','April','May','June','July',
      'August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`;
  }

  /* Plain digits, no thousands separator — the paper form writes 10457, and
     a sheet that is being compared against the typed one by eye should not
     differ in the one number on it. */
  const num = (n) => (n == null || n === '' ? '' : String(Math.round(Number(n))));

  /* How tall the sheet has to be, worked out before anything is drawn —
     a canvas cannot be made taller once it has something on it. */
  function measure(trays) {
    let h = PAD
      + 34 + 30 + 30 + 34        // the four title lines
      + 34                        // the gap under the title
      + 40 + 40                   // batch, breed
      + 40                        // actual planted
      + 30;                       // the gap above the first table
    (trays || []).forEach((t) => {
      h += 44                      // "Tray : P1" band
         + 76                      // the two-deep header row
         + 42 * Math.max(1, (t.holes || []).length)
         + 34;                     // the gap to the next table
    });
    return h + 150 + PAD;          // the signature block, then the margin
  }

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function box(ctx, x, y, w, h, fill) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);
  }

  function centred(ctx, text, x, w, y) {
    ctx.textAlign = 'center';
    ctx.fillText(String(text), x + w / 2, y);
    ctx.textAlign = 'left';
  }

  /**
   * Draw the sheet.
   *
   *   batch         the batch number, as the batch holds it
   *   breed         its breed
   *   actualPlanted seeds actually planted — total less the empty holes
   *   date          YYYY-MM-DD, the day the case is being opened
   *   auditor       who is being asked to audit it, printed under the line
   *   trays         [{ tray, holes: [{ row, hole }] }], in tray order
   *
   * Returns { dataUrl, width, height } — and a File, where the browser can
   * make one, so it can be dropped straight into a file input.
   */
  function draw(o) {
    const opts = o || {};
    const trays = (opts.trays || []).filter((t) => t && (t.holes || []).length);
    const H = measure(trays);

    const cv = document.createElement('canvas');
    cv.width = W * SCALE;
    cv.height = H * SCALE;
    const ctx = cv.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = LINE;
    ctx.textBaseline = 'alphabetic';

    let y = PAD + 26;

    /* ── The heading, as the paper has it ───────────────────────── */
    const title = [
      ['bold 25px ' + SERIF, 'MEGA JUTAMAS SDN BHD', 34],
      ['bold 19px ' + SERIF, 'MJ NURSERY', 30],
      ['bold 19px ' + SERIF, 'LAPORAN LUBANG KOSONG SELEPAS TANAM', 30],
      ['bold 19px ' + SERIF, '(SEED PLANTING EMPTY HOLE REPORT)', 34]
    ];
    title.forEach(([font, text, step]) => {
      ctx.font = font;
      centred(ctx, text, 0, W, y);
      // Underlined, the way the form is typed.
      const w = ctx.measureText(text).width;
      ctx.lineWidth = 1.4; ctx.strokeStyle = LINE;
      line(ctx, (W - w) / 2, y + 5, (W + w) / 2, y + 5);
      y += step;
    });
    y += 34;

    /* ── What batch this is ──────────────────────────────────────
       Each answer sits on a ruled line, like the form. The label is right
       aligned against the rule so the three line up whatever their length. */
    const labelRight = PAD + 230;
    const ruleEnd = W - PAD - 480;
    const field = (label, value) => {
      ctx.font = 'bold 17px ' + SERIF;
      ctx.textAlign = 'right';
      ctx.fillText(label, labelRight, y);
      ctx.textAlign = 'left';
      ctx.font = '17px ' + SERIF;
      ctx.fillText(String(value == null ? '' : value), labelRight + 16, y);
      ctx.lineWidth = 1; ctx.strokeStyle = LINE;
      line(ctx, labelRight + 10, y + 7, ruleEnd, y + 7);
      y += 40;
    };
    field('Nombor Batch :', opts.batch || '');
    /* The breed is not on the paper form, which was typed when there was one
       breed. It is on the batch, and an auditor holding two sheets for two
       batches has no other way to tell which seed he is looking at. */
    field('Baka (Breed) :', opts.breed || '');
    field('Sebenar Biji Tanam :', num(opts.actualPlanted));
    y += 30;

    /* ── A table per tray ────────────────────────────────────────── */
    /* Narrower than the margins and centred, as the paper is: the tables
       hold four short columns and a full-width rule round them reads as a
       spreadsheet rather than a form. */
    const tableW = Math.round(W * 0.78);
    const tableX = Math.round((W - tableW) / 2);
    // No. · Garis (Row) · Lubang (Column) · Audit
    const cols = [0.14, 0.26, 0.30, 0.30].map((f) => f * tableW);
    const colX = cols.reduce((acc, w) => { acc.push(acc[acc.length - 1] + w); return acc; },
                             [tableX]);
    const dateLine = 'Tarikh : ' + longDate(opts.date);

    trays.forEach((t) => {
      // The tray band — one pink cell across the whole table.
      box(ctx, tableX, y, tableW, 44, PINK);
      ctx.font = 'bold 17px ' + SERIF;
      ctx.fillStyle = LINE;
      centred(ctx, 'Tray : ' + (t.tray || ''), tableX, tableW, y + 29);
      y += 44;

      /* The header, two deep. No., Garis and Lubang run the full height;
         Audit is split so the date sits under it, which is where the
         auditor signs the sheet off. */
      const hTop = 38, hBot = 38, hAll = hTop + hBot;
      box(ctx, colX[0], y, cols[0], hAll, PINK);
      box(ctx, colX[1], y, cols[1], hAll, PINK);
      box(ctx, colX[2], y, cols[2], hAll, PINK);
      box(ctx, colX[3], y, cols[3], hTop, PINK);
      box(ctx, colX[3], y + hTop, cols[3], hBot, PINK);
      ctx.fillStyle = LINE;
      ctx.font = 'bold 16px ' + SERIF;
      centred(ctx, 'No.', colX[0], cols[0], y + hAll / 2 + 6);
      centred(ctx, 'Garis', colX[1], cols[1], y + hAll / 2 - 2);
      centred(ctx, 'Lubang', colX[2], cols[2], y + hAll / 2 - 2);
      ctx.font = '13px ' + SERIF;
      centred(ctx, '(Row)', colX[1], cols[1], y + hAll / 2 + 17);
      centred(ctx, '(Column)', colX[2], cols[2], y + hAll / 2 + 17);
      ctx.font = 'bold 16px ' + SERIF;
      centred(ctx, 'Audit', colX[3], cols[3], y + 25);
      ctx.font = 'bold 13px ' + SERIF;
      centred(ctx, dateLine, colX[3], cols[3], y + hTop + 24);
      y += hAll;

      // A line per hole, numbered down the sheet, with a box to tick.
      ctx.font = '16px ' + SERIF;
      (t.holes || []).forEach((h, i) => {
        box(ctx, colX[0], y, cols[0], 42);
        box(ctx, colX[1], y, cols[1], 42);
        box(ctx, colX[2], y, cols[2], 42);
        box(ctx, colX[3], y, cols[3], 42);
        ctx.fillStyle = LINE;
        ctx.font = '16px ' + SERIF;
        centred(ctx, i + 1, colX[0], cols[0], y + 27);
        centred(ctx, h.row == null ? '' : h.row, colX[1], cols[1], y + 27);
        centred(ctx, h.hole == null ? '' : h.hole, colX[2], cols[2], y + 27);
        // The tick box. Empty on purpose — the auditor fills it in.
        ctx.lineWidth = 1.2; ctx.strokeStyle = LINE;
        ctx.strokeRect(colX[3] + cols[3] / 2 - 9, y + 12, 18, 18);
        y += 42;
      });
      y += 34;
    });

    /* ── Who audits it ───────────────────────────────────────────── */
    const sigX = W - PAD - 320;
    ctx.fillStyle = LINE;
    ctx.font = 'bold 17px ' + SERIF;
    centred(ctx, 'Diaudit oleh,', sigX, 320, y + 40);
    ctx.lineWidth = 1.2; ctx.strokeStyle = LINE;
    line(ctx, sigX + 50, y + 108, sigX + 270, y + 108);
    ctx.font = 'bold 17px ' + SERIF;
    centred(ctx, opts.auditor || '', sigX, 320, y + 132);

    const dataUrl = cv.toDataURL('image/png');
    return {
      dataUrl,
      width: cv.width,
      height: cv.height,
      name: `Empty_Hole_Report_Batch_${String(opts.batch || '').replace(/[^0-9A-Za-z]/g, '') || 'x'}.png`
    };
  }

  /* A data URL back into a File, so it can be put into a file input exactly
     as if somebody had chosen it. Kept here beside draw() because every
     caller of one wants the other. */
  function toFile(dataUrl, name) {
    const bin = atob(String(dataUrl).split(',')[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name || 'report.png', { type: 'image/png' });
  }

  global.MJMEmptyHoleReport = { draw, toFile, longDate };
})(typeof window !== 'undefined' ? window : globalThis);
