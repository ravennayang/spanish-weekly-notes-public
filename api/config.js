module.exports = function handler(_request, response) {
  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.status(200).send(`window.APP_CONFIG = ${JSON.stringify({
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  })};`);
};
