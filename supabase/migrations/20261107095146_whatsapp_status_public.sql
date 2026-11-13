-- The WhatsApp webhook has no staff login and the app runs without the secret key, so it records delivery
-- status as the public (anon) role, after checking Meta's signature. Safe to expose: it needs WhatsApp's
-- unguessable message id (never shown publicly) and only moves a Terms send's delivery status forward.
grant execute on function public.record_whatsapp_status(text, text, text) to anon, authenticated;
