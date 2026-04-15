/* ================================================================
   MJM NURSERY — SUPABASE SHARED CONFIG
   supabase.js  —  include this in every HTML file
   ================================================================ */

const SUPA_URL = 'https://shbzvlkfdplqvibmhfgg.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoYnp2bGtmZHBscXZpYm1oZmdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTI0MjUsImV4cCI6MjA5MTc2ODQyNX0.0dT8ptTlPN9cmBH8aS7Wd5fUrscN3IsRNh5z44M63_w';

/* ----------------------------------------------------------------
   BASE FETCH WRAPPER
---------------------------------------------------------------- */
async function sbFetch(path, options = {}) {
  const url = `${SUPA_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

/* ----------------------------------------------------------------
   CRUD HELPERS
---------------------------------------------------------------- */
const sb = {
  // SELECT
  async select(table, query = '') {
    return sbFetch(`${table}?${query}&order=created_at.desc`);
  },

  // INSERT
  async insert(table, data) {
    return sbFetch(table, {
      method: 'POST',
      body: JSON.stringify(data),
      prefer: 'return=representation'
    });
  },

  // UPDATE
  async update(table, id, data) {
    return sbFetch(`${table}?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      prefer: 'return=representation'
    });
  },

  // DELETE
  async delete(table, id) {
    return sbFetch(`${table}?id=eq.${id}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
      headers: { 'Prefer': 'return=minimal' }
    });
  },

  // UPLOAD PHOTO to Supabase Storage → returns public URL
  async uploadPhoto(bucket, filename, base64dataUrl) {
    if (!base64dataUrl) return null;
    // convert base64 to blob
    const [meta, data] = base64dataUrl.split(',');
    const mime = meta.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const ext  = mime.split('/')[1] || 'jpg';
    const path = `${filename}_${Date.now()}.${ext}`;

    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${bucket}/${path}`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': mime,
          'x-upsert': 'true'
        },
        body: blob
      }
    );
    if (!res.ok) { console.error('Photo upload failed', await res.text()); return null; }
    return `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};