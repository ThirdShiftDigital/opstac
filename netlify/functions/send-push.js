const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BPlXIkiapZIvnJWTiWeajKwezI9OQNvqm_uwukZy57sGQ_VMM9VmdT0s2QUJ4G6QUJOdKz6IDOQuG-Em1OCPKEI';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'uKIC7XfsJWFNkRvxniQjd7tpxUFQsc2_nFVX4IrAxWM';

webpush.setVapidDetails('mailto:notifications@opstac.net', VAPID_PUBLIC, VAPID_PRIVATE);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) } }

  const { accessToken, agencyId, title, body: text } = body;
  if (!accessToken || !agencyId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData || !userData.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('agency_id', agencyId);
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const payload = JSON.stringify({
    title: title || 'OpsTac Callout',
    body: text || 'New activation',
    url: '/app.html',
    tag: 'opstac-callout'
  });

  const results = [];
  for (const sub of subs || []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload, { urgency: 'high', TTL: 120 });
      results.push({ id: sub.id, ok: true });
    } catch (err) {
      results.push({ id: sub.id, ok: false, status: err.statusCode });
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.ok).length, results }) };
};
