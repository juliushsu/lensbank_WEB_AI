import express from 'express';
import { registerAttendanceRoutes } from './routes';
import { supabaseJwtAuth } from './middleware/supabaseJwtAuth';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(supabaseJwtAuth);

  registerAttendanceRoutes(app);

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`attendance api listening on :${port}`);
  });
}
